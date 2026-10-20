import { MILLS, SIGNAL_IDS, SignalId } from './signals';
export const okMill = (m: string | null) => (m && (MILLS as readonly string[]).includes(m) ? m : MILLS[0]);
export const okSignals = (s: string | null): SignalId[] => {
  const l = (s ?? '').split(',').filter((x) => (SIGNAL_IDS as string[]).includes(x)) as SignalId[];
  return l.length ? l : SIGNAL_IDS;
};
export function pivot(rows: { signal: string; t: string | number; avg: number; min: number; max: number }[]) {
  const m = new Map<number, any>();
  for (const r of rows) {
    const t = Number(r.t);
    const o = m.get(t) ?? m.set(t, { t }).get(t);
    o[r.signal] = +Number(r.avg).toFixed(3); o[r.signal + '_min'] = +Number(r.min).toFixed(3); o[r.signal + '_max'] = +Number(r.max).toFixed(3);
  }
  return [...m.values()].sort((a, b) => a.t - b.t);
}
