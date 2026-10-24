'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SignalChart from '@/components/SignalChart';
import DigitalTwin from '@/components/DigitalTwin';
import { SIGNALS } from '@/lib/signals';

const MILL_IDS = ['RM-01', 'RM-02'];
export default function Live() {
  const [mill, setMill] = useState('RM-01'), [secs, setSecs] = useState(60), [sel, setSel] = useState<string[]>(SIGNALS.map((s) => s.id));
  const [d, setD] = useState<any>(null), [msg, setMsg] = useState('');
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (busy.current) return; busy.current = true;
      try { const r = await fetch(`/api/live?mill=${mill}&seconds=${secs}`, { cache: 'no-store' }); if (r.ok && alive) setD(await r.json()); } finally { busy.current = false; }
    };
    setD(null); tick(); const h = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(h); };
  }, [mill, secs]);

  const areas = (d?.alerts ?? []).map((a: any) => ({ from: new Date(a.start_ts).getTime(), to: new Date(a.end_ts).getTime() }));
  const WHAT: Record<string, string> = { precursor: 'Precursor (near miss, ~12 s)', cobble: 'Cobble (3 s)', escalation: 'Precursor → cobble (~15 s)' };
  async function inject(kind: 'precursor' | 'cobble' | 'escalation') {
    const r = await fetch('/api/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mill, kind }) });
    const j = await r.json(); setMsg(r.ok ? `${WHAT[kind]} scheduled for ${new Date(j.startsAt).toLocaleTimeString()} on ${mill} - watch the twin and charts.` : j.error);
  }
  return (
    <>
      <div className="row">
        <h2 style={{ margin: 0 }}>Live monitoring</h2>
        <select value={mill} onChange={(e) => setMill(e.target.value)}>{MILL_IDS.map((m) => <option key={m}>{m}</option>)}</select>
        <select value={secs} onChange={(e) => setSecs(+e.target.value)}>{[30, 60, 120, 300].map((s) => <option key={s} value={s}>last {s}s</option>)}</select>
        <span className={`badge ${d?.status ?? 'STALE'}`}>{d?.status === 'NORMAL' && <span className="pulse" />}{d?.status ?? 'CONNECTING'}</span>
        <span className="muted">{d?.lastTs ? `last sample ${new Date(d.lastTs).toLocaleTimeString()} · 50 Hz source, charts downsampled to ${d.bucketMs} ms` : ''}</span>
        <span style={{ flex: 1 }} /><button onClick={() => inject('precursor')} style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>Inject precursor</button>
        <button className="danger" onClick={() => inject('cobble')}>Inject cobble</button>
        <button onClick={() => inject('escalation')} style={{ borderColor: 'var(--crit)' }}>Precursor → cobble</button>
      </div>
      {msg && <div className="card" style={{ marginBottom: '1rem' }}>{msg}</div>}
      <div className="twinrow">
        <div className="card"><DigitalTwin values={d?.latest ?? {}} title={`${mill} · 4-high roughing stand`} /></div>
        <div className="grid g6" style={{ alignContent: 'start' }}>
          {SIGNALS.map((s) => (
            <div key={s.id} className="card kpi"><div className="l">{s.label}</div>
              <div><span className="v" style={{ color: s.color }}>{d?.latest?.[s.id] !== undefined ? Number(d.latest[s.id]).toFixed(s.id === 'motor_speed' || s.id === 'rolling_force' ? 0 : 1) : '–'}</span><span className="u">{s.unit}</span></div></div>
          ))}
        </div>
      </div>
      <div className="chips" style={{ marginBottom: '.8rem' }}>
        {SIGNALS.map((s) => <span key={s.id} className={`chip ${sel.includes(s.id) ? 'on' : ''}`} onClick={() => setSel(sel.includes(s.id) ? sel.filter((x) => x !== s.id) : [...sel, s.id])}>{s.label}</span>)}
      </div>
      <div className="grid g3">
        {SIGNALS.filter((s) => sel.includes(s.id)).map((s) => (
          <div className="card" key={s.id}><h3 style={{ fontSize: 13 }}>{s.label} <span className="muted">({s.unit})</span></h3>
            <SignalChart data={d?.series ?? []} dataKey={s.id} color={s.color} unit={s.unit} areas={areas} /></div>
        ))}
      </div>
      <h3 style={{ marginTop: '1.4rem' }}>Latest alerts · {mill}</h3>
      <div className="card"><table><tbody>
        {(d?.alerts ?? []).length === 0 && <tr><td className="muted">No alerts yet.</td></tr>}
        {(d?.alerts ?? []).map((a: any) => (
          <tr key={a.id}><td><span className={`badge ${a.severity}`}>{a.severity}</span></td><td>{new Date(a.start_ts).toLocaleString()}</td><td>{a.signals.join(', ')}</td><td className="muted">{a.reason}</td><td><Link href={`/alerts/${a.id}`}>Inspect →</Link></td></tr>))}
      </tbody></table></div>
    </>
  );
}
