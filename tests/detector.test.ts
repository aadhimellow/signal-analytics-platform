import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, cobbleStartsBetween, CYCLE_MS } from '../lib/simulator';
import { detect, WINDOW_MS, WindowSeries } from '../lib/detector';
import { SIGNAL_IDS, phaseOf } from '../lib/signals';
import { sample } from '../lib/simulator';

function windows(mill: string, fromMs: number, toMs: number, manual = []) {
  const rows = generate(mill, fromMs, toMs, manual);
  const acc: Record<string, Map<number, number[]>> = {};
  for (const id of SIGNAL_IDS) acc[id] = new Map();
  for (const r of rows) {
    const b = Math.floor(Date.parse(r.timestamp) / WINDOW_MS);
    (acc[r.signal].get(b) ?? acc[r.signal].set(b, []).get(b)!).push(r.value);
  }
  const keys = [...acc.motor_current.keys()].sort((a, b) => a - b);
  const w = {} as WindowSeries;
  for (const id of SIGNAL_IDS) w[id] = keys.map((k) => acc[id].get(k)!.reduce((a, b) => a + b, 0) / acc[id].get(k)!.length);
  return { w, t0: keys[0] * WINDOW_MS };
}
const T0 = 1_760_000_000_000 - ((1_760_000_000_000) % CYCLE_MS); // cycle-aligned

test('simulator is deterministic', () => {
  assert.deepEqual(generate('RM-01', T0, T0 + 200), generate('RM-01', T0, T0 + 200));
});
test('full cycle: ONE precursor warning, then ONE cobble; load change is NOT flagged; precursor leads the cobble', () => {
  const { w, t0 } = windows('RM-01', T0, T0 + CYCLE_MS); // load change @150s, precursor @408s, cobble @420s
  const inc = detect(w);
  const at = (i: any) => t0 + i.startIdx * WINDOW_MS - T0;
  assert.deepEqual(inc.map((i) => i.kind), ['cobble_precursor', 'cobble_signature'], JSON.stringify(inc.map((i) => [i.kind, at(i)])));
  const [pre, cob] = inc;
  assert.ok(at(pre) >= 408_000 && at(pre) <= 416_000, `precursor start ${at(pre)}`);
  assert.ok(at(cob) >= 420_000 && at(cob) <= 421_500, `cobble start ${at(cob)}`);
  assert.ok(at(cob) - at(pre) >= 4_000, 'lead time should be >= 4 s');
  assert.equal(pre.severity, 'warning'); assert.equal(cob.severity, 'critical');
});
test('normal operation incl. the legitimate load change raises nothing', () => {
  const { w } = windows('RM-01', T0, T0 + 400_000); // load change @150s, no cobble before 420s
  assert.equal(detect(w).length, 0);
});
test('operator-injected cobble (no precursor) is detected as a single critical alert', () => {
  const { w } = windows('RM-01', T0, T0 + 120_000, [{ kind: 'cobble', startMs: T0 + 60_000 }] as any);
  const inc = detect(w);
  assert.deepEqual(inc.map((i) => i.kind), ['cobble_signature']);
});
test('injected stand-alone precursor (near miss) -> one warning and NO cobble alert', () => {
  const { w } = windows('RM-01', T0, T0 + 120_000, [{ kind: 'precursor', startMs: T0 + 40_000, fade: true }] as any);
  const inc = detect(w);
  assert.deepEqual(inc.map((i) => i.kind), ['cobble_precursor'], JSON.stringify(inc.map((i) => i.kind)));
});
test('injected escalation (precursor -> cobble) gives warning first, then critical', () => {
  const s = T0 + 40_000;
  const { w } = windows('RM-01', T0, T0 + 120_000, [{ kind: 'precursor', startMs: s, fade: false }, { kind: 'cobble', startMs: s + 12_000 }] as any);
  assert.deepEqual(detect(w).map((i) => i.kind), ['cobble_precursor', 'cobble_signature']);
});
test('scheduled cobble list', () => {
  assert.equal(cobbleStartsBetween('RM-01', T0, T0 + CYCLE_MS)[0], T0 + 420_000);
});

test('twin phase is derived from values: stable -> heavy (load change) -> cobble', () => {
  assert.equal(phaseOf(sample('RM-01', T0 + 10_000)), 'stable');
  assert.equal(phaseOf(sample('RM-01', T0 + 200_000)), 'heavy');        // inside the +20 % load-change hold
  assert.equal(phaseOf(sample('RM-01', T0 + 421_500)), 'cobble');       // mid-cobble
  assert.equal(phaseOf(sample('RM-01', T0 + 417_000)), 'precursor');    // 3 s before the jam: slip/chatter, no current surge
});

test('batch boundary mid-precursor does not leak a single-signal outlier (streaming safety)', () => {
  const start = T0 + 40_000;
  for (const cut of [3500, 4500, 5500, 6500, 8000]) { // detection window ends at different points inside the ramp
    const { w } = windows('RM-01', T0, start + cut, [{ kind: 'precursor', startMs: start, fade: true }] as any);
    assert.ok(detect(w).every((i) => i.kind !== 'signal_outlier'), `outlier leaked when cut at +${cut} ms`);
  }
});
test('a truly isolated vibration spike (sensor fault) still raises a single-signal warning', () => {
  const { w } = windows('RM-01', T0, T0 + 60_000);
  for (let k = 200; k < 210; k++) w.vibration[k] *= 6; // 2 s spike on vibration only
  assert.deepEqual(detect(w).map((i) => i.kind), ['signal_outlier']);
});
