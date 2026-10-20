/**
 * Hybrid anomaly detector (pure functions, no I/O -> unit-testable).
 *
 * Features: 200 ms window means per signal. For every window a *robust z-score* is computed against a
 * lagged rolling baseline (median / MAD of the previous ~10 s, ending 1 s ago) so the baseline adapts to
 * legitimate operating-point changes but is not polluted by the incident itself.
 *
 *  Rule A  COBBLE SIGNATURE (critical): current z>=4 AND torque z>=4 AND (speed z<=-3 OR vibration z>=5)
 *          AND >=3 signals with |z|>=4, persisting >=2 windows. A legitimate load change moves speed UP together with
 *          current/torque, slowly, so it never satisfies the "surge with speed collapse / vibration burst" shape.
 *  Rule B  SINGLE-SIGNAL OUTLIER (warning): any signal |z|>=8 for >=4 consecutive windows that Rule A did not explain.
 */
import { SIGNAL_META, SignalId } from './signals';

export const WINDOW_MS = 200;
const BASE_FROM = 55, BASE_TO = 5; // windows back: 11 s ... 1 s
const MIN_HISTORY = 56;

export type WindowSeries = Record<SignalId, number[]>; // aligned arrays of window means
export type DetectedIncident = {
  kind: 'cobble_signature' | 'signal_outlier';
  severity: 'critical' | 'warning';
  startIdx: number; endIdx: number; // inclusive window indexes
  signals: SignalId[]; score: number; reason: string;
  details: Record<string, { peak: number; baseline: number; pct: number; z: number }>;
};

export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y); const n = s.length;
  return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
export function robustStats(base: number[]) {
  const med = median(base);
  const mad = median(base.map((v) => Math.abs(v - med))) * 1.4826;
  return { med, scale: Math.max(mad, 0.04 * Math.abs(med), 1e-6) }; // floor avoids hair-trigger on very quiet signals
}

export function zScores(series: number[]): { z: number[]; base: number[] } {
  const z = new Array(series.length).fill(0), base = new Array(series.length).fill(NaN);
  for (let k = MIN_HISTORY; k < series.length; k++) {
    const { med, scale } = robustStats(series.slice(k - BASE_FROM, k - BASE_TO));
    z[k] = (series[k] - med) / scale; base[k] = med;
  }
  return { z, base };
}

function runs(flags: boolean[], maxGap: number): [number, number][] {
  const out: [number, number][] = []; let s = -1, last = -1;
  flags.forEach((f, i) => {
    if (!f) return;
    if (s >= 0 && i - last - 1 <= maxGap) last = i; else { if (s >= 0) out.push([s, last]); s = i; last = i; }
  });
  if (s >= 0) out.push([s, last]);
  return out;
}

export function detect(w: WindowSeries): DetectedIncident[] {
  const n = w.motor_current?.length ?? 0;
  const Z: Record<string, { z: number[]; base: number[] }> = {};
  for (const id of Object.keys(w) as SignalId[]) Z[id] = zScores(w[id]);
  const ids = Object.keys(Z) as SignalId[];
  const zz = (id: SignalId, k: number) => Z[id]?.z[k] ?? 0;
  const incidents: DetectedIncident[] = [];

  // Rule A
  const flagA = Array.from({ length: n }, (_, k) => {
    if (k < MIN_HISTORY) return false;
    const strong = ids.filter((id) => Math.abs(zz(id, k)) >= 4).length;
    return zz('motor_current', k) >= 4 && zz('torque', k) >= 4 && (zz('motor_speed', k) <= -3 || zz('vibration', k) >= 5) && strong >= 3;
  });
  const covered = new Set<number>();
  for (const [s, e] of runs(flagA, 4)) {
    if (e - s + 1 < 2) continue;
    for (let k = s; k <= e; k++) covered.add(k);
    const details: DetectedIncident['details'] = {}; const sig: SignalId[] = [];
    for (const id of ids) {
      let pk = 0, pz = 0, b = 0;
      for (let k = s; k <= e; k++) if (Math.abs(zz(id, k)) > Math.abs(pz)) { pz = zz(id, k); pk = w[id][k]; b = Z[id].base[k]; }
      if (Math.abs(pz) >= 4) sig.push(id);
      details[id] = { peak: pk, baseline: b, pct: b ? ((pk - b) / b) * 100 : 0, z: pz };
    }
    const f = (id: SignalId) => `${SIGNAL_META[id].label.toLowerCase()} ${details[id].pct >= 0 ? '+' : ''}${details[id].pct.toFixed(0)}%`;
    incidents.push({
      kind: 'cobble_signature', severity: 'critical', startIdx: s, endIdx: e, signals: sig,
      score: Math.min(100, Math.abs(details.motor_current.z) + Math.abs(details.torque.z)),
      reason: `Cobble signature: ${f('motor_current')}, ${f('torque')}, ${f('motor_speed')}, vibration x${(1 + details.vibration.pct / 100).toFixed(1)} vs 10 s baseline - ` +
        `simultaneous current/torque surge with speed collapse and vibration burst (a legitimate load change raises speed and ramps slowly).`,
      details,
    });
  }
  // Rule B
  for (const id of ids) {
    const flags = Array.from({ length: n }, (_, k) => Math.abs(zz(id, k)) >= 8 && !covered.has(k));
    for (const [s, e] of runs(flags, 2)) {
      if (e - s + 1 < 4) continue;
      let pz = 0, pk = 0, b = 0;
      for (let k = s; k <= e; k++) if (Math.abs(zz(id, k)) > Math.abs(pz)) { pz = zz(id, k); pk = w[id][k]; b = Z[id].base[k]; }
      incidents.push({
        kind: 'signal_outlier', severity: 'warning', startIdx: s, endIdx: e, signals: [id], score: Math.min(100, Math.abs(pz)),
        reason: `${SIGNAL_META[id].label} deviates ${pz >= 0 ? 'above' : 'below'} its rolling baseline (robust z=${pz.toFixed(1)}) for ${(e - s + 1) * WINDOW_MS} ms without a matching multi-signal pattern.`,
        details: { [id]: { peak: pk, baseline: b, pct: b ? ((pk - b) / b) * 100 : 0, z: pz } },
      });
    }
  }
  return incidents.sort((a, b) => a.startIdx - b.startIdx);
}
