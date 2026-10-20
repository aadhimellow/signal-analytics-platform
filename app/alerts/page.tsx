'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
export default function Alerts() {
  const [rows, setRows] = useState<any[]>([]), [mill, setMill] = useState('');
  useEffect(() => { fetch('/api/alerts' + (mill ? `?mill=${mill}` : '')).then((r) => r.json()).then((j) => setRows(j.alerts ?? [])); }, [mill]);
  return (
    <>
      <div className="row"><h2 style={{ margin: 0 }}>Alert history</h2>
        <select value={mill} onChange={(e) => setMill(e.target.value)}><option value="">All mills</option><option>RM-01</option><option>RM-02</option></select></div>
      <div className="card"><table>
        <thead><tr><th>Severity</th><th>Mill</th><th>Detected (start)</th><th>Duration</th><th>Affected signals</th><th>Reason</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="muted">No alerts recorded yet.</td></tr>}
          {rows.map((a) => (
            <tr key={a.id}><td><span className={`badge ${a.severity}`}>{a.severity}</span></td><td>{a.mill_id}</td><td>{new Date(a.start_ts).toLocaleString()}</td>
              <td>{((new Date(a.end_ts).getTime() - new Date(a.start_ts).getTime()) / 1000).toFixed(1)} s</td><td>{a.signals.join(', ')}</td>
              <td className="muted" style={{ maxWidth: 520 }}>{a.reason}</td><td>{a.status}</td><td><Link href={`/alerts/${a.id}`}>Inspect →</Link></td></tr>))}
        </tbody></table></div>
    </>
  );
}
