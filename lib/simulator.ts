/**
 * Deterministic "virtual PLC" for a rolling-mill stand.
 *
 * sample(mill, tMs) is a pure function of time (+ operator-injected events), so the same period can be
 * regenerated, replayed and verified at any time. Scenario per 10-minute cycle:
 *   t+150 s  LOAD CHANGE  - speed setpoint +20 % (15 s ramp, 60 s hold, 15 s ramp back). Legitimate, must NOT alert.
 *   t+420 s  COBBLE       - strip jams in the stand: current/torque/force surge, speed collapses, vibration bursts.
 * Operators can inject extra cobbles through scenario_events.
 */
import { SAMPLE_MS, SIGNAL_IDS, SignalId, SIGNAL_META } from './signals';

export const CYCLE_MS = 600_000;
const LOAD_AT = 150_000, LOAD_RAMP = 15_000, LOAD_HOLD = 60_000;
const COBBLE_AT = 420_000;
export const COBBLE_MS = 5_000;
const MILL_OFFSET: Record<string, number> = { 'RM-01': 0, 'RM-02': 200_000 };

export type ManualEvent = { kind: 'cobble'; startMs: number };

// --- tiny deterministic PRNG: hash(index, salt) -> N(0,1) ----------------------------------------------------
function hash(a: number, b: number): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function gauss(i: number, salt: number): number {
  const u = Math.max(hash(i, salt), 1e-12), v = hash(i, salt + 7919);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/** 0..1 share of the legitimate load change that is active at cycle-time c (ms). */
function loadFactor(c: number): number {
  const a = c - LOAD_AT;
  if (a < 0) return 0;
  if (a < LOAD_RAMP) return smooth(a / LOAD_RAMP);
  if (a < LOAD_RAMP + LOAD_HOLD) return 1;
  const d = a - LOAD_RAMP - LOAD_HOLD;
  return d < LOAD_RAMP ? 1 - smooth(d / LOAD_RAMP) : 0;
}

/** cobble progress in seconds since onset, or null when no cobble is active. */
function cobbleAge(mill: string, tMs: number, manual: ManualEvent[]): number | null {
  const off = MILL_OFFSET[mill] ?? 0;
  const c = (((tMs + off) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  if (c >= COBBLE_AT && c < COBBLE_AT + COBBLE_MS) return (c - COBBLE_AT) / 1000;
  for (const e of manual) if (tMs >= e.startMs && tMs < e.startMs + COBBLE_MS) return (tMs - e.startMs) / 1000;
  return null;
}

export function sample(mill: string, tMs: number, manual: ManualEvent[] = []): Record<SignalId, number> {
  const i = Math.floor(tMs / SAMPLE_MS);
  const off = MILL_OFFSET[mill] ?? 0;
  const c = (((tMs + off) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  const L = loadFactor(c);
  const age = cobbleAge(mill, tMs, manual);
  const sec = tMs / 1000;
  const m = (mill === 'RM-02' ? 1.04 : 1) as number; // second mill runs slightly harder
  const sl = (k: number, p: number) => Math.sin((2 * Math.PI * sec) / p + k);

  // normal operation + legitimate load change (everything moves together, smoothly)
  let speed = 600 * m * (1 + 0.2 * L) + 3 * sl(1, 7) + 2.5 * gauss(i, 1);
  let current = 400 * m * (1 + 0.15 * L) + 8 * sl(2, 5) + 5 * gauss(i, 2);
  let torque = 12 * m * (1 + 0.1 * L) + 0.25 * sl(3, 6) + 0.12 * gauss(i, 3);
  let force = 2500 * m * (1 + 0.08 * L) + 40 * sl(4, 9) + 25 * gauss(i, 4);
  let vib = 2 * (1 + 0.1 * L) + 0.25 * sl(5, 3) + 0.15 * gauss(i, 5);
  vib = Math.abs(vib);
  const temp = 78 + 0.0 * sec + 4 * Math.sin((2 * Math.PI * sec) / 900) + 6 * L + 0.05 * gauss(i, 6);

  if (age !== null) {
    const on = smooth(age / 0.25);                       // rapid onset (250 ms)
    const off2 = 1 - smooth((age - (COBBLE_MS / 1000 - 0.6)) / 0.6); // release over last 600 ms
    const k = Math.min(on, off2);
    current *= 1 + 1.4 * k + 0.15 * k * sl(8, 0.35);
    torque *= 1 + 1.2 * k + 0.1 * k * sl(9, 0.4);
    force *= 1 + 0.9 * k + 0.12 * k * sl(10, 0.3);
    speed *= 1 - 0.2 * k;
    vib = vib * (1 + 4 * k) + 1.2 * k * Math.abs(gauss(i, 11));
  }
  return { motor_speed: speed, motor_current: current, torque, rolling_force: force, vibration: vib, temperature: temp };
}

export type Reading = { mill_id: string; signal: SignalId; timestamp: string; value: number; unit: string; quality: number };

/** All readings for [fromMs, toMs) on the 20 ms grid. */
export function generate(mill: string, fromMs: number, toMs: number, manual: ManualEvent[] = []): Reading[] {
  const out: Reading[] = [];
  const start = Math.ceil(fromMs / SAMPLE_MS) * SAMPLE_MS;
  for (let t = start; t < toMs; t += SAMPLE_MS) {
    const s = sample(mill, t, manual);
    const iso = new Date(t).toISOString();
    for (const id of SIGNAL_IDS) {
      out.push({ mill_id: mill, signal: id, timestamp: iso, value: Math.round(s[id] * 1000) / 1000, unit: SIGNAL_META[id].unit, quality: 0 });
    }
  }
  return out;
}

/** Next scheduled (cyclic) cobble start at/after tMs, for docs/UI hints. */
export function cobbleStartsBetween(mill: string, fromMs: number, toMs: number): number[] {
  const off = MILL_OFFSET[mill] ?? 0;
  const res: number[] = [];
  for (let k = Math.floor((fromMs + off) / CYCLE_MS) - 1; k * CYCLE_MS - off < toMs; k++) {
    const s = k * CYCLE_MS + COBBLE_AT - off;
    if (s >= fromMs && s < toMs) res.push(s);
  }
  return res;
}
