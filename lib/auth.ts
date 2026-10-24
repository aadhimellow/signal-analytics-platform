import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { q } from './db';

export const COOKIE = 'mono_session';
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-only-secret-change-me');

export async function createSession(user: { id: number; email: string }) {
  const token = await new SignJWT({ email: user.email }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id)).setIssuedAt().setExpirationTime('7d').sign(secret());
  cookies().set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 86400 });
}
export async function verifyToken(token?: string) {
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, secret()); return { id: Number(payload.sub), email: String(payload.email) }; } catch { return null; }
}
export const currentUser = () => verifyToken(cookies().get(COOKIE)?.value);

export const normalizeCode = (c: unknown) => String(c ?? '').trim().toUpperCase();
export const CODE_RE = /^[A-Z0-9-]{4,32}$/;

export type RegisterResult = { ok: true; user: { id: number; email: string } } | { ok: false; reason: 'bad_code' | 'email_taken' };
/**
 * Creates an account ONLY if `employeeCode` exists in `employees`, is active and has not been used before.
 * One atomic statement: the code is claimed by the same INSERT that creates the user (users.employee_code is UNIQUE),
 * so two people cannot claim one code at the same moment, and a failed signup (e.g. email taken) does not burn the code.
 */
export async function registerUser(email: string, password: string, employeeCode: string): Promise<RegisterResult> {
  const hash = await bcrypt.hash(password, 10);
  try {
    const rows = await q<{ id: number; email: string }>(
      `INSERT INTO users(email, password_hash, employee_code)
       SELECT $1, $2, e.employee_code FROM employees e WHERE e.employee_code = $3 AND e.is_active
       RETURNING id, email`, [email.toLowerCase(), hash, employeeCode]);
    return rows[0] ? { ok: true, user: rows[0] } : { ok: false, reason: 'bad_code' }; // unknown or deactivated code
  } catch (e: any) {
    if (e.code === '23505') return { ok: false, reason: e.constraint === 'users_employee_code_key' ? 'bad_code' : 'email_taken' }; // code already used / email exists
    throw e;
  }
}
export async function checkLogin(email: string, password: string) {
  const [u] = await q<{ id: number; email: string; password_hash: string }>('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
  return u && (await bcrypt.compare(password, u.password_hash)) ? { id: u.id, email: u.email } : null;
}
/** Route-handler guard: returns the user or a 401 Response. */
export async function requireUser() {
  const u = await currentUser();
  return u ?? null;
}
