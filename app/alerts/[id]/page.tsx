'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import SignalChart from '@/components/SignalChart';
import { SIGNALS } from '@/lib/signals';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function Incident({ params }: { params: { id: string } }) {
  const [d, setD] = useState<any>(null);
  const load = () => fetch(`/api/alerts/${params.id}`).then((r) => r.json()).then(setD);
  useEffect(() => { load(); }, [params.id]);
  if (!d) return <p className="muted">Loading…</p>;
  if (d.error) return <p>Alert not found. <Link href="/alerts">Back</Link></p>;
  const a = d.alert, s = new Date(a.start_ts).getTime(), e = new Date(a.end_ts).getTime();
  const areas = [{ from: s, to: e }];
  const cmp: Record<string, any> = Object.fromEntries(d.comparison.map((c: any) => [c.signal, c]));
  // normalised overlay: % deviation from each signal's pre-incident normal mean
  const norm = d.series.map((p: any) => { const o: any = { t: p.t }; for (const sg of SIGNALS) if (cmp[sg.id]?.normalMean) o[sg.id] = ((p[sg.id] - cmp[sg.id].normalMean) / cmp[sg.id].normalMean) * 100; return o; });
  const ack = async () => { await fetch(`/api/alerts/${a.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'acknowledged' }) }); load(); };
  return (
    <>
      <p><Link href="/alerts">← Alert history</Link></p>
      <div className="row"><h2 style={{ margin: 0 }}>Alert #{a.id} · {a.mill_id}</h2><span className={`badge ${a.severity}`}>{a.severity}</span><span className="badge STALE">{a.kind}</span>
        <span className="muted">status: {a.status}</span>{a.status === 'open' && <button onClick={ack}>Acknowledge</button>}</div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div><b>Triggered:</b> {new Date(a.start_ts).toLocaleString()} → {new Date(a.end_ts).toLocaleTimeString()} ({((e - s) / 1000).toFixed(1)} s) · <b>Score:</b> {a.score.toFixed(0)}</div>
        <div><b>Affected signals:</b> {a.signals.join(', ')}</div><div style={{ marginTop: 6 }}><b>Why:</b> {a.reason}</div>
      </div>
      <h3>Normal vs incident</h3>
      <div className="card" style={{ marginBottom: '1rem' }}><table>
        <thead><tr><th>Signal</th><th>Normal (30 s before) mean ± σ</th><th>Incident extreme</th><th>Change</th><th>Deviation</th></tr></thead>
        <tbody>{SIGNALS.map((sg) => { const c = cmp[sg.id]; return c?.normalMean === undefined ? null : (
          <tr key={sg.id}><td style={{ color: sg.color }}>{sg.label} ({sg.unit})</td><td>{c.normalMean.toFixed(1)} ± {c.normalStd.toFixed(2)}</td><td>{c.incidentExtreme.toFixed(1)}</td>
            <td style={{ color: Math.abs(c.pctChange) > 20 ? 'var(--crit)' : undefined }}>{c.pctChange >= 0 ? '+' : ''}{c.pctChange.toFixed(0)}%</td><td>{c.sigma.toFixed(0)} σ</td></tr>); })}</tbody></table></div>
      <h3>All signals, % change from normal <span className="muted" style={{ fontSize: 12 }}>(red band = alert window)</span></h3>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <ResponsiveContainer width="100%" height={280}><LineChart data={norm} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#243142" strokeDasharray="3 3" /><XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} stroke="#8b9bb0" fontSize={11} tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour12: false })} />
          <YAxis stroke="#8b9bb0" fontSize={11} unit="%" /><Tooltip contentStyle={{ background: '#121923', border: '1px solid #243142' }} labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString()} formatter={(v: any) => `${Number(v).toFixed(0)}%`} />
          <ReferenceArea x1={s} x2={e} fill="#ff4d5e" fillOpacity={0.18} />
          {SIGNALS.map((sg) => <Line key={sg.id} dataKey={sg.id} name={sg.label} stroke={sg.color} dot={false} strokeWidth={1.5} isAnimationActive={false} />)}
        </LineChart></ResponsiveContainer>
        <div className="chips">{SIGNALS.map((sg) => <span key={sg.id} style={{ color: sg.color }}>● {sg.label}</span>)}</div>
      </div>
      <div className="grid g3">{SIGNALS.map((sg) => (
        <div className="card" key={sg.id}><h3 style={{ fontSize: 13 }}>{sg.label} <span className="muted">({sg.unit})</span></h3>
          <SignalChart data={d.series} dataKey={sg.id} color={sg.color} unit={sg.unit} areas={areas} baseline={cmp[sg.id]?.normalMean} /></div>))}</div>
    </>
  );
}
