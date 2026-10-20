'use client';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Props = { data: any[]; dataKey: string; color: string; unit?: string; height?: number; areas?: { from: number; to: number }[]; baseline?: number; band?: boolean };
const fmt = (t: number, ms = false) => new Date(t).toLocaleTimeString([], { hour12: false, ...(ms ? { fractionalSecondDigits: 1 } : {}) } as any);

export default function SignalChart({ data, dataKey, color, unit, height = 170, areas = [], baseline }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="#243142" strokeDasharray="3 3" />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => fmt(t)} stroke="#8b9bb0" fontSize={11} minTickGap={50} />
        <YAxis stroke="#8b9bb0" fontSize={11} domain={['auto', 'auto']} width={56} tickFormatter={(v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Number(v).toFixed(1))} />
        <Tooltip contentStyle={{ background: '#121923', border: '1px solid #243142' }} labelFormatter={(t) => fmt(Number(t), true)} formatter={(v: any) => [`${Number(v).toFixed(2)} ${unit ?? ''}`, dataKey]} />
        {areas.map((a, i) => <ReferenceArea key={i} x1={a.from} x2={a.to} fill="#ff4d5e" fillOpacity={0.18} stroke="#ff4d5e" strokeOpacity={0.5} />)}
        {baseline !== undefined && <ReferenceLine y={baseline} stroke="#2ecc71" strokeDasharray="5 4" label={{ value: 'normal', fill: '#2ecc71', fontSize: 10, position: 'insideTopLeft' }} />}
        <Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={1.6} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
