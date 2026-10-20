import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { okMill, okSignals, pivot } from '@/lib/util';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const mill = okMill(u.searchParams.get('mill'));
  const signals = okSignals(u.searchParams.get('signals'));
  const to = Date.parse(u.searchParams.get('to') ?? '') || Date.now();
  const from = Date.parse(u.searchParams.get('from') ?? '') || to - 15 * 60_000;
  if (to <= from) return NextResponse.json({ error: 'to must be after from' }, { status: 400 });
  if (to - from > 7 * 86400_000) return NextResponse.json({ error: 'max range is 7 days' }, { status: 400 });
  await ensureSchema();
  const span = to - from, F = new Date(from), T = new Date(to);

  let rows, resolution: string, bucketMs: number;
  if (span <= 120_000) {            // raw 20 ms data, downsampled to ~<=1000 points
    bucketMs = Math.max(20, Math.ceil(span / 1000 / 20) * 20); resolution = `raw (${bucketMs} ms buckets)`;
    rows = await q(`SELECT signal,(floor(extract(epoch from ts)*1000/$5)*$5)::bigint t,avg(value) avg,min(value) min,max(value) max
      FROM readings WHERE mill_id=$1 AND signal=ANY($2) AND ts>=$3 AND ts<$4 GROUP BY 1,2 ORDER BY 2`, [mill, signals, F, T, bucketMs]);
  } else {                          // 1 s rollups, re-bucketed to ~<=800 points (weighted mean, true min/max)
    bucketMs = Math.max(1000, Math.ceil(span / 800 / 1000) * 1000); resolution = `1 s rollups (${bucketMs / 1000} s buckets)`;
    rows = await q(`SELECT signal,(floor(extract(epoch from bucket)*1000/$5)*$5)::bigint t,sum(avg*n)/sum(n) avg,min(min) min,max(max) max
      FROM rollup_1s WHERE mill_id=$1 AND signal=ANY($2) AND bucket>=$3 AND bucket<$4 GROUP BY 1,2 ORDER BY 2`, [mill, signals, F, T, bucketMs]);
  }

  const alerts = await q(`SELECT id,kind,severity,start_ts,end_ts,signals,reason,score,status FROM alerts WHERE mill_id=$1 AND end_ts>=$2 AND start_ts<=$3 ORDER BY start_ts`, [mill, F, T]);
  // normal vs abnormal comparison, from rollups
  const summary = await q(
    `WITH r AS (
       SELECT ro.signal, ro.avg, ro.min, ro.max, ro.std, ro.n,
              EXISTS (SELECT 1 FROM alerts a WHERE a.mill_id=ro.mill_id AND ro.bucket BETWEEN a.start_ts - interval '1 second' AND a.end_ts + interval '1 second') AS abnormal
       FROM rollup_1s ro WHERE ro.mill_id=$1 AND ro.signal=ANY($2) AND ro.bucket>=$3 AND ro.bucket<$4)
     SELECT signal, abnormal, sum(avg*n)/sum(n) AS mean, sqrt(sum(std*std*n)/sum(n)) AS std, min(min) AS min, max(max) AS max, sum(n)::int AS samples
     FROM r GROUP BY 1,2 ORDER BY 1,2`, [mill, signals, F, T]);
  return NextResponse.json({ mill, from, to, resolution, bucketMs, series: pivot(rows as any), alerts, summary });
}
