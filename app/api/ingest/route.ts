import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { ingestBatch } from '@/lib/engine';
import { SIGNAL_IDS } from '@/lib/signals';

export const maxDuration = 30;

/**
 * POST /api/ingest   (header: x-api-key)
 * body: { readings: [{ mill_id, signal, timestamp, value, unit?, quality? }, ...] }   (max 20 000 per call)
 */
export async function POST(req: Request) {
  if (req.headers.get('x-api-key') !== (process.env.INGEST_API_KEY || 'dev-ingest-key'))
    return NextResponse.json({ error: 'invalid api key' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const list = body?.readings;
  if (!Array.isArray(list) || list.length === 0 || list.length > 20_000)
    return NextResponse.json({ error: 'readings must be a non-empty array (<= 20000)' }, { status: 400 });
  const valid: any[] = [], rejected: number[] = [];
  list.forEach((r: any, i: number) => {
    const ok = typeof r?.mill_id === 'string' && SIGNAL_IDS.includes(r.signal) && Number.isFinite(Date.parse(r.timestamp)) && Number.isFinite(r.value);
    if (ok) valid.push({ mill_id: r.mill_id, signal: r.signal, timestamp: new Date(r.timestamp).toISOString(), value: r.value, unit: r.unit ?? '', quality: r.quality ?? 0 });
    else if (rejected.length < 20) rejected.push(i);
  });
  await ensureSchema();
  const res = valid.length ? await ingestBatch(valid as any) : { inserted: 0, alerts: 0 };
  return NextResponse.json({ received: list.length, accepted: valid.length, rejectedSample: rejected, ...res });
}
