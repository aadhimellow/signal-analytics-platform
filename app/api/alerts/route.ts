import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const mill = new URL(req.url).searchParams.get('mill');
  await ensureSchema();
  const rows = await q(`SELECT id,mill_id,kind,severity,start_ts,end_ts,signals,reason,score,status,created_at FROM alerts
     WHERE ($1::text IS NULL OR mill_id=$1) ORDER BY start_ts DESC LIMIT 200`, [mill]);
  return NextResponse.json({ alerts: rows });
}
