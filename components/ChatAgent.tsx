'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Card = { id: number; mill: string; kind: string; severity: string; started_at: string; duration_seconds: number; headline: string };
type Turn = { role: 'user' | 'assistant'; content: string; alerts?: Card[]; note?: string };

/** **bold**, "- " bullets and line breaks only (no HTML injection: everything is rendered as React text). */
function Rich({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
  return <>{text.split('\n').map((l, i) => l.startsWith('- ') ? <div key={i} className="cbullet">• {inline(l.slice(2))}</div> : l.trim() === '' ? <div key={i} style={{ height: 6 }} /> : <div key={i}>{inline(l)}</div>)}</>;
}

export default function ChatAgent() {
  const [open, setOpen] = useState(false), [turns, setTurns] = useState<Turn[]>([]), [input, setInput] = useState('');
  const [busy, setBusy] = useState(false), [meta, setMeta] = useState<{ llm: boolean; suggestions: string[] } | null>(null), [follow, setFollow] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null), box = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open && !meta) fetch('/api/chat').then((r) => r.json()).then(setMeta).catch(() => setMeta({ llm: false, suggestions: [] })); }, [open, meta]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, busy]);
  useEffect(() => { if (open) box.current?.focus(); const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]);

  async function ask(q: string) {
    const text = q.trim(); if (!text || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }]; setTurns(next); setInput(''); setBusy(true); setFollow([]);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Request failed');
      setTurns([...next, { role: 'assistant', content: j.reply, alerts: j.alerts, note: j.note }]); setFollow(j.followups ?? []);
    } catch (e: any) { setTurns([...next, { role: 'assistant', content: e.message || 'Sorry, something went wrong. Please try again.' }]); }
    finally { setBusy(false); }
  }

  return (
    <>
      {open && (
        <div className="chat" role="dialog" aria-label="Mono Edge assistant">
          <div className="chat-h"><div><b>Mono Edge Assistant</b><div className="muted" style={{ fontSize: 11 }}>{meta?.llm ? 'AI-powered · answers from your plant data' : 'Answers from your plant data'}</div></div>
            <button className="chat-x" onClick={() => setOpen(false)} aria-label="Close chat">✕</button></div>
          <div className="chat-b">
            {turns.length === 0 && (<div className="bot">Hi! I can tell you what happened in the mill - recent alerts, why they happened, and how the sensors have been behaving. Try one of these:</div>)}
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'me' : 'bot'}>
                {t.role === 'user' ? t.content : <Rich text={t.content} />}
                {t.alerts && t.alerts.length > 0 && (
                  <div className="cards">{t.alerts.map((a) => (
                    <Link key={a.id} href={`/alerts/${a.id}`} className="acard"><span className={`badge ${a.severity}`}>{a.severity === 'critical' ? 'serious' : a.severity}</span>
                      <span>#{a.id} · {a.mill} · {a.headline}<br /><span className="muted">{new Date(a.started_at).toLocaleString()} · {a.duration_seconds}s</span></span><span>→</span></Link>))}</div>)}
                {t.note && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t.note}</div>}
              </div>))}
            {busy && <div className="bot typing"><i /><i /><i /></div>}
            <div ref={end} />
          </div>
          <div className="chat-s">{(turns.length === 0 ? meta?.suggestions ?? [] : follow).map((s) => <button key={s} className="sugg" onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
          <form className="chat-i" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input ref={box} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about alerts or history…" maxLength={500} aria-label="Your question" />
            <button className="primary" disabled={busy || !input.trim()}>Send</button>
          </form>
        </div>)}
      <button className="chat-fab" onClick={() => setOpen(!open)} aria-label={open ? 'Close assistant' : 'Open assistant'} title="Ask the assistant">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
      </button>
    </>
  );
}
