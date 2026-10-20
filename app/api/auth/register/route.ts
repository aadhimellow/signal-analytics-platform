import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { registerUser, createSession } from '@/lib/auth';

export async function POST(req: Request) {
  await ensureSchema();
  const { email, password } = await req.json().catch(() => ({}));
  if (!/^\S+@\S+\.\S+$/.test(email ?? '') || (password ?? '').length < 8)
    return NextResponse.json({ error: 'Valid email and a password of at least 8 characters are required.' }, { status: 400 });
  try { await createSession(await registerUser(email, password)); return NextResponse.json({ ok: true }); }
  catch (e: any) { return NextResponse.json({ error: e.code === '23505' ? 'That email is already registered.' : 'Registration failed.' }, { status: 409 }); }
}
