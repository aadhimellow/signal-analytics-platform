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

export async function registerUser(email: string, password: string) {
  const hash = await bcrypt.hash(password, 10);
  const rows = await q<{ id: number; email: string }>('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email', [email.toLowerCase(), hash]);
  return rows[0];
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
