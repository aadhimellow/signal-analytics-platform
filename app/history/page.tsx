'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import SignalChart from '@/components/SignalChart';
import { SIGNALS } from '@/lib/signals';

const local = (ms: number) => { const d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
export default function History() {
  const [mill, setMill] = useState('RM-01'), [sel, setSel] = useState<string[]>(['motor_current', 'motor_speed', 'vibration']);
  const [to, setTo] = useState(local(Date.now())), [from, setFrom] = useState(local(Date.now() - 15 * 60000));
  const [d, setD] = useState<any>(null), [loading, setLoading] = useState(false);
  const preset = (min: number) => { setTo(local(Date.now())); setFrom(local(Date.now() - min * 60000)); };
  async function run() {
    setLoading(true);
    const p = new URLSearchParams({ mill, signals: sel.join(','), from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    setD(await (await fetch(`/api/history?${p}`)).json()); setLoading(false);
  }
  useEffect(() => { run(); }, []); // initial load
  const areas = (d?.alerts ?? []).map((a: any) => ({ from: new Date(a.start_ts).getTime(), to: new Date(a.end_ts).getTime() }));
  const S = (sig: string, ab: boolean) => d?.summary?.find((x: any) => x.signal === sig && x.abnormal === ab);
  return (
    <>
      <h2>Historical analytics</h2>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row">
          <select value={mill} onChange={(e) => setMill(e.target.value)}><option>RM-01</option><option>RM-02</option></select>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /><span>→</span><input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          {[5, 15, 60].map((m) => <button key={m} onClick={() => preset(m)}>last {m >= 60 ? '1 h' : `${m} min`}</button>)}
          <button className="primary" onClick={run} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
        </div>
        <div className="chips">{SIGNALS.map((s) => <span key={s.id} className={`chip ${sel.includes(s.id) ? 'on' : ''}`} onClick={() => setSel(sel.includes(s.id) ? sel.filter((x) => x !== s.id) : [...sel, s.id])}>{s.label}</span>)}</div>
      </div>
      {d?.error && <div className="card err">{d.error}</div>}
      {d?.series && <p className="muted">Resolution: {d.resolution} · {d.series.length} points · red bands are recorded alerts (<Link href="/alerts">all alerts</Link>)</p>}
      <div className="grid g3">{SIGNALS.filter((s) => sel.includes(s.id)).map((s) => (
        <div className="card" key={s.id}><h3 style={{ fontSize: 13 }}>{s.label} <span className="muted">({s.unit})</span></h3><SignalChart data={d?.series ?? []} dataKey={s.id} color={s.color} unit={s.unit} areas={areas} /></div>))}</div>
      <h3 style={{ marginTop: '1.4rem' }}>Normal vs abnormal periods in range</h3>
      <div className="card"><table>
        <thead><tr><th>Signal</th><th>Normal mean ± σ</th><th>Normal max</th><th>Abnormal mean ± σ</th><th>Abnormal max</th><th>Mean shift</th></tr></thead>
        <tbody>{SIGNALS.filter((s) => sel.includes(s.id)).map((s) => { const n = S(s.id, false), a = S(s.id, true); return (
          <tr key={s.id}><td style={{ color: s.color }}>{s.label} ({s.unit})</td>
            <td>{n ? `${n.mean.toFixed(1)} ± ${n.std.toFixed(1)}` : '–'}</td><td>{n ? n.max.toFixed(1) : '–'}</td>
            <td>{a ? `${a.mean.toFixed(1)} ± ${a.std.toFixed(1)}` : <span className="muted">no incident in range</span>}</td><td>{a ? a.max.toFixed(1) : '–'}</td>
            <td>{n && a ? `${(((a.mean - n.mean) / n.mean) * 100).toFixed(0)}%` : '–'}</td></tr>); })}</tbody></table></div>
      <h3 style={{ marginTop: '1.4rem' }}>Alerts in range</h3>
      <div className="card"><table><tbody>
        {(d?.alerts ?? []).length === 0 && <tr><td className="muted">None in this range.</td></tr>}
        {(d?.alerts ?? []).map((a: any) => <tr key={a.id}><td><span className={`badge ${a.severity}`}>{a.severity}</span></td><td>{new Date(a.start_ts).toLocaleString()}</td><td>{a.signals.join(', ')}</td><td className="muted">{a.reason}</td><td><Link href={`/alerts/${a.id}`}>Inspect →</Link></td></tr>)}
      </tbody></table></div>
    </>
  );
}
