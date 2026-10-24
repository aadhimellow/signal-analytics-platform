import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { registerUser, createSession, normalizeCode, CODE_RE } from '@/lib/auth';

// Best-effort brute-force guard for employee codes: 8 attempts / 10 min per IP (per server instance).
const tries = new Map<string, number[]>();
const tooMany = (ip: string) => { const now = Date.now(), a = (tries.get(ip) ?? []).filter((t) => now - t < 600_000); a.push(now); tries.set(ip, a); return a.length > 8; };

const BAD_CODE = 'That employee code is not valid or has already been used. Please check it or ask your supervisor.';

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  if (tooMany(ip)) return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 });
  await ensureSchema();
  const { email, password, employeeCode } = await req.json().catch(() => ({}));
  const code = normalizeCode(employeeCode);
  if (!code) return NextResponse.json({ error: 'An employee code is required to create an account.' }, { status: 400 });
  if (!CODE_RE.test(code)) return NextResponse.json({ error: BAD_CODE }, { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(email ?? '') || (password ?? '').length < 8)
    return NextResponse.json({ error: 'Valid email and a password of at least 8 characters are required.' }, { status: 400 });
  const r = await registerUser(email, password, code);
  if (!r.ok) return r.reason === 'email_taken'
    ? NextResponse.json({ error: 'That email is already registered.' }, { status: 409 })
    : NextResponse.json({ error: BAD_CODE }, { status: 403 }); // same message for unknown / inactive / already-used: no hints to guessers
  await createSession(r.user);
  return NextResponse.json({ ok: true });
}
