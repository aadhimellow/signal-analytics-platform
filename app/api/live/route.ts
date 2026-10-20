import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { advanceSimulator } from '@/lib/engine';
import { okMill, pivot } from '@/lib/util';
import { SIGNAL_IDS } from '@/lib/signals';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const mill = okMill(u.searchParams.get('mill'));
  const seconds = Math.min(300, Math.max(10, Number(u.searchParams.get('seconds') ?? 60)));
  await ensureSchema();
  await advanceSimulator();

  const [last] = await q<{ ts: Date | null }>(`SELECT max(ts) AS ts FROM readings WHERE mill_id=$1 AND signal='motor_current'`, [mill]);
  if (!last?.ts) return NextResponse.json({ mill, status: 'NO_DATA', series: [], latest: {}, alerts: [] });
  const lastMs = last.ts.getTime();
  const bucket = seconds <= 60 ? 250 : seconds <= 120 ? 500 : 1000;

  const rows = await q(
    `SELECT signal, (floor(extract(epoch from ts)*1000/$3)*$3)::bigint AS t, avg(value) avg, min(value) min, max(value) max
     FROM readings WHERE mill_id=$1 AND ts > $2 GROUP BY 1,2 ORDER BY 2`,
    [mill, new Date(lastMs - seconds * 1000), bucket],
  );
  const latest = await q<{ signal: string; value: number }>(
    `SELECT DISTINCT ON (signal) signal, value FROM readings WHERE mill_id=$1 AND ts > $2 ORDER BY signal, ts DESC`, [mill, new Date(lastMs - 2000)]);
  const alerts = await q(`SELECT id,kind,severity,start_ts,end_ts,signals,reason,score,status FROM alerts WHERE mill_id=$1 ORDER BY start_ts DESC LIMIT 5`, [mill]);
  const recent = alerts.find((a: any) => new Date(a.end_ts).getTime() > lastMs - 30_000);
  const stale = Date.now() - lastMs > 15_000;
  return NextResponse.json({
    mill, lastTs: lastMs, bucketMs: bucket,
    status: stale ? 'STALE' : recent ? (recent.severity === 'critical' ? 'ALARM' : 'WARNING') : 'NORMAL',
    latest: Object.fromEntries(latest.map((l) => [l.signal, l.value])),
    series: pivot(rows as any), alerts, signals: SIGNAL_IDS,
  });
}
