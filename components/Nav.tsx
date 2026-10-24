'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
export default function Nav() {
  const p = usePathname(), r = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  // hooks must run before the early return below
  useEffect(() => {
    if (p === '/login') { setEmail(null); return; }
    let alive = true;
    fetch('/api/auth/me').then((x) => x.json()).then((j) => { if (alive) setEmail(j.user?.email ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, [p]);
  if (p === '/login') return null;
  const L = (href: string, t: string) => <Link href={href} className={p === href || (href !== '/' && p.startsWith(href)) ? 'active' : ''}>{t}</Link>;
  return (
    <nav>
      <span className="brand">MONO EDGE</span>{L('/', 'Live')}{L('/history', 'History')}{L('/alerts', 'Alerts')}<span className="sp" />
      {email && <span className="who" title={`Signed in as ${email}`}>{email}</span>}
      <button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); setEmail(null); r.push('/login'); }}>Sign out</button>
    </nav>
  );
}
