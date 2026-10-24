import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { SUGGESTIONS, answer, llmEnabled, Msg } from '@/lib/chat/agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const hits = new Map<string, number[]>(); // best-effort per-instance rate limit: 20 questions / minute / user
const limited = (k: string) => { const now = Date.now(), a = (hits.get(k) ?? []).filter((t) => now - t < 60_000); a.push(now); hits.set(k, a); return a.length > 20; };

export async function GET() {
  const llm = llmEnabled();
  if (llm) console.info('[chat] LLM is enabled');
  return NextResponse.json({ llm, suggestions: SUGGESTIONS });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (limited(String(user.id))) return NextResponse.json({ error: 'Too many questions - please wait a moment.' }, { status: 429 });
  const body = await req.json().catch(() => null);
  let msgs: Msg[] = Array.isArray(body?.messages) ? body.messages.filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string').map((m: any) => ({ role: m.role, content: m.content.slice(0, 1000) })).slice(-10) : [];
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return NextResponse.json({ error: 'Send at least one question.' }, { status: 400 });
  await ensureSchema();
  try { return NextResponse.json(await answer(msgs, body?.tz)); }
  catch (e) { console.error('[chat]', e); return NextResponse.json({ error: 'Sorry, I could not look that up right now.' }, { status: 500 }); }
}
