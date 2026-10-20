'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
export default function Nav() {
  const p = usePathname(), r = useRouter();
  if (p === '/login') return null;
  const L = (href: string, t: string) => <Link href={href} className={p === href || (href !== '/' && p.startsWith(href)) ? 'active' : ''}>{t}</Link>;
  return (
    <nav>
      <span className="brand">MONO EDGE</span>{L('/', 'Live')}{L('/history', 'History')}{L('/alerts', 'Alerts')}<span className="sp" />
      <button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); r.push('/login'); }}>Sign out</button>
    </nav>
  );
}
