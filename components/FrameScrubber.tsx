'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DigitalTwin from './DigitalTwin';
import { SIGNALS, phaseOf } from '@/lib/signals';

const HZ = 50; // 20 ms frames
type Data = { alert: { id: number; mill_id: string; startMs: number; endMs: number }; frames: any[]; baseline: Record<string, { mean: number; std: number }> };

/** All six signals as % deviation from the pre-incident normal; static (memoised) so scrubbing at 50 fps stays smooth. */
const Strip = memo(function Strip({ frames, baseline, w, h, yMin, yMax }: { frames: any[]; baseline: Data['baseline']; w: number; h: number; yMin: number; yMax: number }) {
  const lines = useMemo(() => SIGNALS.map((s) => {
    const b = baseline[s.id]?.mean; if (!b) return null;
    const pts = frames.map((f, i) => `${((i / (frames.length - 1)) * w).toFixed(1)},${(h - ((((f[s.id] - b) / b) * 100 - yMin) / (yMax - yMin)) * h).toFixed(1)}`).join(' ');
    return <polyline key={s.id} points={pts} fill="none" stroke={s.color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />;
  }), [frames, baseline, w, h, yMin, yMax]);
  return <>{lines}</>;
});

export default function FrameScrubber({ alertId }: { alertId: number | string }) {
  const [d, setD] = useState<Data | null>(null), [err, setErr] = useState('');
  const [idx, setIdx] = useState(0), [playing, setPlaying] = useState(false), [rate, setRate] = useState(0.25);
  const pos = useRef(0);

  useEffect(() => {
    fetch(`/api/alerts/${alertId}/frames`).then((r) => r.json()).then((j: Data & { error?: string }) => {
      if (j.error || !j.frames?.length) return setErr(j.error ?? 'No raw frames retained for this alert (outside retention window).');
      setD(j);
      const peak = j.frames.reduce((best, f, i) => (f.motor_current > j.frames[best].motor_current ? i : best), 0);
      pos.current = peak; setIdx(peak);
    }).catch(() => setErr('Failed to load frames'));
  }, [alertId]);

  // playback: advance `rate × 50` frames per second using rAF, render only when the integer frame changes
  useEffect(() => {
    if (!playing || !d) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      pos.current += ((now - last) / 1000) * HZ * rate; last = now;
      if (pos.current >= d.frames.length - 1) { pos.current = d.frames.length - 1; setIdx(d.frames.length - 1); setPlaying(false); return; }
      setIdx(Math.floor(pos.current)); raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, d]);

  const seek = useCallback((i: number) => { pos.current = i; setIdx(Math.max(0, Math.min(i, (d?.frames.length ?? 1) - 1))); }, [d]);
  const bounds = useMemo(() => {
    if (!d) return { yMin: -50, yMax: 150 };
    let lo = 0, hi = 0;
    for (const f of d.frames) for (const s of SIGNALS) { const b = d.baseline[s.id]?.mean; if (b) { const p = ((f[s.id] - b) / b) * 100; lo = Math.min(lo, p); hi = Math.max(hi, p); } }
    return { yMin: Math.floor(lo / 10) * 10 - 10, yMax: Math.ceil(hi / 10) * 10 + 10 };
  }, [d]);

  if (err) return <div className="card muted">{err}</div>;
  if (!d) return <div className="card muted">Loading 20 ms frames…</div>;

  const N = d.frames.length, f = d.frames[Math.min(idx, N - 1)];
  const { startMs, endMs } = d.alert, rel = (f.t - startMs) / 1000;
  const inAlert = f.t >= startMs && f.t <= endMs;
  const iStart = d.frames.findIndex((x) => x.t >= startMs), iEnd = Math.max(iStart, d.frames.findIndex((x) => x.t > endMs) - 1);
  const W = 1000, H = 180, xOf = (i: number) => (i / (N - 1)) * W, yZero = H - ((0 - bounds.yMin) / (bounds.yMax - bounds.yMin)) * H;
  const peak = d.frames.reduce((b, x, i) => (x.motor_current > d.frames[b].motor_current ? i : b), 0);

  return (
    <div className="scrub">
      <div className="card"><DigitalTwin values={f} title={`${d.alert.mill_id} · frame ${idx + 1}/${N}`} animate={playing} /></div>
      <div className="card">
        <div className="row" style={{ marginBottom: '.4rem' }}>
          <span className="mono" style={{ fontWeight: 700 }}>{new Date(f.t).toLocaleTimeString([], { hour12: false })}.{String(f.t % 1000).padStart(3, '0')}</span>
          <span className="mono muted">T{rel >= 0 ? '+' : '−'}{Math.abs(rel).toFixed(2)} s vs alert start</span>
          <span className={`phase ${phaseOf(f)}`}>{phaseOf(f)}</span>
          {inAlert && <span className="badge critical">inside alert window</span>}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 150, cursor: 'pointer', background: '#0a141d', borderRadius: 8 }}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(Math.round(((e.clientX - r.left) / r.width) * (N - 1))); }}>
          <rect x={xOf(iStart)} width={Math.max(2, xOf(iEnd) - xOf(iStart))} y={0} height={H} fill="rgba(255,77,94,.16)" />
          <line x1={0} x2={W} y1={yZero} y2={yZero} stroke="#2ecc71" strokeDasharray="6 5" strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
          <Strip frames={d.frames} baseline={d.baseline} w={W} h={H} yMin={bounds.yMin} yMax={bounds.yMax} />
          <line x1={xOf(idx)} x2={xOf(idx)} y1={0} y2={H} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="muted" style={{ fontSize: 11 }}>% change from normal · dashed line = normal · red band = alert · click the chart to seek · {SIGNALS.map((s) => <span key={s.id} style={{ color: s.color, marginRight: 8 }}>● {s.label}</span>)}</div>
        <input type="range" min={0} max={N - 1} value={idx} onChange={(e) => { setPlaying(false); seek(+e.target.value); }} style={{ marginTop: 8 }} aria-label="Frame scrubber" />
        <div className="btnrow" style={{ marginBottom: '.7rem' }}>
          <button onClick={() => { setPlaying(false); seek(Math.max(iStart, 0)); }}>⏮ Alert start</button>
          <button onClick={() => { setPlaying(false); seek(idx - 1); }} title="previous 20 ms frame">◀ −20 ms</button>
          <button className="primary" onClick={() => { if (idx >= N - 1) seek(0); setPlaying(!playing); }}>{playing ? '⏸ Pause' : '▶ Play'}</button>
          <button onClick={() => { setPlaying(false); seek(idx + 1); }} title="next 20 ms frame">+20 ms ▶</button>
          <button onClick={() => { setPlaying(false); seek(peak); }}>⚡ Peak</button>
          <select value={rate} onChange={(e) => setRate(+e.target.value)} aria-label="playback speed">{[0.1, 0.25, 0.5, 1, 4].map((r) => <option key={r} value={r}>{r === 1 ? '1× (real time)' : `${r}×`}</option>)}</select>
        </div>
        <table><thead><tr><th>Signal</th><th>Normal (mean ± σ)</th><th>This frame</th><th>Change</th><th>σ</th></tr></thead>
          <tbody>{SIGNALS.map((s) => {
            const b = d.baseline[s.id], val = f[s.id]; if (!b || val === undefined) return null;
            const pct = ((val - b.mean) / b.mean) * 100, sig = (val - b.mean) / Math.max(b.std, 1e-9), bad = Math.abs(sig) >= 4 && Math.abs(pct) >= 10;
            return (<tr key={s.id}><td style={{ color: s.color }}>{s.label} ({s.unit})</td><td className="mono">{b.mean.toFixed(1)} ± {b.std.toFixed(2)}</td><td className="mono">{val.toFixed(1)}</td>
              <td className="mono" style={{ color: bad ? 'var(--crit)' : undefined, fontWeight: bad ? 700 : 400 }}>{pct >= 0 ? '+' : ''}{pct.toFixed(0)}%</td><td className="mono">{sig.toFixed(1)}</td></tr>);
          })}</tbody></table>
      </div>
    </div>
  );
}
