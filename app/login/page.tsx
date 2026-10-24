'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export default function Login() {
  const r = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [code, setCode] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const res = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mode === 'register' ? { email, password, employeeCode: code } : { email, password }) });
    if (res.ok) { r.push('/'); r.refresh(); } else setErr((await res.json()).error ?? 'Failed');
    setBusy(false);
  }
  return (
    <div className="login card">
      <h2 style={{ letterSpacing: '.14em' }}>MONO EDGE</h2>
      <p className="muted">Signal Analytics · {mode === 'login' ? 'Sign in' : 'Create account'}</p>
      <form onSubmit={submit}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {mode === 'register' && (<>
          <input placeholder="Employee code (e.g. EMP-XXXXXX)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required maxLength={32} autoComplete="off" spellCheck={false} aria-label="Employee code" />
          <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>Only Mono Edge employees can create an account. Ask your supervisor for your code.</p>
        </>)}
        {err && <div className="err">{err}</div>}
        <button className="primary" style={{ width: '100%' }} disabled={busy}>{mode === 'login' ? 'Sign in' : 'Sign up'}</button>
      </form>
      <p className="muted" style={{ marginTop: '1rem' }}>
        {mode === 'login' ? 'No account? ' : 'Have an account? '}
        <a href="#" onClick={(e) => { e.preventDefault(); setErr(''); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'Sign up' : 'Sign in'}</a>
      </p>
    </div>
  );
}