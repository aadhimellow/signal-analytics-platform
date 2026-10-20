import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { checkLogin, createSession } from '@/lib/auth';

export async function POST(req: Request) {
  await ensureSchema();
  const { email, password } = await req.json().catch(() => ({}));
  const u = await checkLogin(String(email ?? ''), String(password ?? ''));
  if (!u) return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  await createSession(u);
  return NextResponse.json({ ok: true });
}
