import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { pivot } from '@/lib/util';
import { SIGNAL_IDS } from '@/lib/signals';

export const dynamic = 'force-dynamic';
const PAD = 30_000;

export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureSchema();
  const [alert] = await q<any>('SELECT * FROM alerts WHERE id=$1', [Number(params.id)]);
  if (!alert) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const s = new Date(alert.start_ts).getTime(), e = new Date(alert.end_ts).getTime();
  const from = new Date(s - PAD), to = new Date(e + PAD);
  const rows = await q(`SELECT signal,(floor(extract(epoch from ts)*1000/100)*100)::bigint t,avg(value) avg,min(value) min,max(value) max
      FROM readings WHERE mill_id=$1 AND ts>=$2 AND ts<$3 GROUP BY 1,2 ORDER BY 2`, [alert.mill_id, from, to]);
  // "normal reference": the 25 s before the incident, ending 2 s before onset
  const base = await q<{ signal: string; mean: number; std: number }>(
    `SELECT signal, avg(value) mean, COALESCE(stddev_samp(value),0) std FROM readings WHERE mill_id=$1 AND ts>=$2 AND ts<$3 GROUP BY 1`,
    [alert.mill_id, new Date(s - PAD + 3000), new Date(s - 2000)]);
  const during = await q<{ signal: string; peak: number; lo: number; mean: number }>(
    `SELECT signal, max(value) peak, min(value) lo, avg(value) mean FROM readings WHERE mill_id=$1 AND ts>=$2 AND ts<=$3 GROUP BY 1`,
    [alert.mill_id, new Date(s), new Date(e)]);
  const B = Object.fromEntries(base.map((b) => [b.signal, b]));
  const comparison = SIGNAL_IDS.map((id) => {
    const d = during.find((x) => x.signal === id), b = B[id];
    if (!d || !b) return { signal: id };
    const extreme = Math.abs(d.peak - b.mean) >= Math.abs(d.lo - b.mean) ? d.peak : d.lo;
    return { signal: id, normalMean: b.mean, normalStd: b.std, incidentMean: d.mean, incidentExtreme: extreme,
      pctChange: ((extreme - b.mean) / b.mean) * 100, sigma: (extreme - b.mean) / Math.max(b.std, 1e-9) };
  });
  return NextResponse.json({ alert, window: { from: from.getTime(), to: to.getTime() }, series: pivot(rows as any), comparison });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { status } = await req.json().catch(() => ({}));
  if (!['open', 'acknowledged'].includes(status)) return NextResponse.json({ error: 'bad status' }, { status: 400 });
  await q('UPDATE alerts SET status=$2 WHERE id=$1', [Number(params.id), status]);
  return NextResponse.json({ ok: true });
}
