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
test('detects the scheduled cobble exactly once; load change is NOT flagged', () => {
  const { w, t0 } = windows('RM-01', T0, T0 + CYCLE_MS); // full cycle: load change @150s, cobble @420s
  const inc = detect(w);
  assert.equal(inc.length, 1, JSON.stringify(inc.map((i) => [i.kind, t0 + i.startIdx * WINDOW_MS - T0])));
  assert.equal(inc[0].kind, 'cobble_signature');
  const startOffset = t0 + inc[0].startIdx * WINDOW_MS - T0;
  assert.ok(startOffset >= 420_000 && startOffset <= 421_500, `start ${startOffset}`);
});
test('normal operation incl. the legitimate load change raises nothing', () => {
  const { w } = windows('RM-01', T0, T0 + 400_000); // load change @150s, no cobble before 420s
  assert.equal(detect(w).length, 0);
});
test('operator-injected cobble is detected', () => {
  const start = T0 + 60_000;
  const { w } = windows('RM-01', T0, T0 + 120_000, [{ kind: 'cobble', startMs: start }] as any);
  const inc = detect(w);
  assert.equal(inc.length, 1);
});
test('scheduled cobble list', () => {
  assert.equal(cobbleStartsBetween('RM-01', T0, T0 + CYCLE_MS)[0], T0 + 420_000);
});

test('twin phase is derived from values: stable -> heavy (load change) -> cobble', () => {
  assert.equal(phaseOf(sample('RM-01', T0 + 10_000)), 'stable');
  assert.equal(phaseOf(sample('RM-01', T0 + 200_000)), 'heavy');        // inside the +20 % load-change hold
  assert.equal(phaseOf(sample('RM-01', T0 + 421_500)), 'cobble');       // mid-cobble
  assert.equal(phaseOf(sample('RM-02', T0 + 200_000 + 0)), 'stable');   // RM-02 is offset, not in load change here
});
