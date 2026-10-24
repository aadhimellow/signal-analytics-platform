import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { okMill } from '@/lib/util';

/** Reviewer-friendly control: inject a cobble 2 s from now into the embedded virtual PLC. */
export async function POST(req: Request) {
  if (process.env.EMBEDDED_SIMULATOR === 'false') return NextResponse.json({ error: 'embedded simulator disabled' }, { status: 400 });
  const user = await currentUser();
  const { mill, kind } = await req.json().catch(() => ({}));
  const k = ['cobble', 'precursor', 'escalation'].includes(kind) ? kind : 'cobble';
  await ensureSchema();
  const start = Math.ceil((Date.now() + 2000) / 20) * 20;
  await q(`INSERT INTO scenario_events(mill_id,kind,start_ts,created_by) VALUES($1,$4,$2,$3)`, [okMill(mill), new Date(start), user?.email ?? null, k]);
  return NextResponse.json({ ok: true, kind: k, startsAt: new Date(start).toISOString() });
}
