import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Raw 20 ms frames around an alert for the frame scrubber: [start - 4 s, max(start + 6 s, end + 2 s)] (<= 12 s = 600 frames),
 * pivoted to one object per timestamp, plus the "normal" reference (mean/std of the 28 s before onset, ending 2 s before it).
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureSchema();
  const [alert] = await q<any>('SELECT * FROM alerts WHERE id=$1', [Number(params.id)]);
  if (!alert) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const s = new Date(alert.start_ts).getTime(), e = new Date(alert.end_ts).getTime();
  const from = s - 4000, to = Math.min(Math.max(s + 6000, e + 2000), from + 12_000);

  const rows = await q<{ t: string; signal: string; value: number }>(
    `SELECT (extract(epoch from ts)*1000)::bigint AS t, signal, value FROM readings WHERE mill_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts`,
    [alert.mill_id, new Date(from), new Date(to)]);
  const byT = new Map<number, any>();
  for (const r of rows) { const t = Number(r.t); (byT.get(t) ?? byT.set(t, { t }).get(t))[r.signal] = r.value; }
  const frames = [...byT.values()].sort((a, b) => a.t - b.t);

  const base = await q<{ signal: string; mean: number; std: number }>(
    `SELECT signal, avg(value) mean, COALESCE(stddev_samp(value),0) std FROM readings WHERE mill_id=$1 AND ts>=$2 AND ts<$3 GROUP BY 1`,
    [alert.mill_id, new Date(s - 30_000), new Date(s - 2000)]);
  return NextResponse.json({
    alert: { id: alert.id, mill_id: alert.mill_id, severity: alert.severity, startMs: s, endMs: e },
    frames, baseline: Object.fromEntries(base.map((b) => [b.signal, { mean: b.mean, std: b.std }])),
  });
}
