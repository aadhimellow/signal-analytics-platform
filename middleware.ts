import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// Everything except the login page, auth endpoints and the key-protected ingest endpoint needs a session.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open = pathname === '/login' || pathname.startsWith('/api/auth') || pathname === '/api/ingest';
  let ok = false;
  const t = req.cookies.get('mono_session')?.value;
  if (t) { try { await jwtVerify(t, new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-only-secret-change-me')); ok = true; } catch {} }
  if (open || ok) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', req.url));
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
