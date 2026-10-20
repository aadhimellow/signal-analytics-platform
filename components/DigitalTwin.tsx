'use client';
import { NOMINAL, Phase, phaseOf } from '@/lib/signals';

type V = Partial<Record<string, number>>;
const PHASE_LABEL: Record<Phase, string> = { stable: 'Pass stable', heavy: 'Heavy pass · legitimate load change', cobble: 'COBBLE · material jam' };

/**
 * Schematic of a 4-high rolling stand driven purely by signal values:
 *  - roll rotation speed  <- motor_speed       - force arrows (length/colour)  <- rolling_force
 *  - housing shake        <- vibration          - strip turns into a buckled loop when the data shows a cobble
 *  - side read-outs turn red when a signal leaves its normal band
 */
export default function DigitalTwin({ values, title, animate = true }: { values: V; title?: string; animate?: boolean }) {
  const v = (id: keyof typeof NOMINAL) => values[id] ?? NOMINAL[id];
  const ratio = (id: keyof typeof NOMINAL) => v(id) / NOMINAL[id];
  const phase = phaseOf(values);
  const dur = Math.min(12, Math.max(0.8, (2.4 * NOMINAL.motor_speed) / Math.max(v('motor_speed'), 60)));
  const force = Math.min(1.1, Math.max(0.5, ratio('rolling_force') / 2));           // arrow length 0..1
  const forceColor = ratio('rolling_force') > 1.4 ? '#ff4d5e' : ratio('rolling_force') > 1.12 ? '#f5a524' : '#38bdf8';
  const shake = v('vibration') > 5 ? 'shake-h' : v('vibration') > 3 ? 'shake-s' : '';
  const run = animate ? 'running' : 'paused';
  const roll = (cx: number, cy: number, r: number, ccw: boolean, stroke: string, cross: number) => (
    <g className={`roll ${ccw ? 'ccw' : ''}`} style={{ ['--dur' as any]: `${dur}s`, animationPlayState: run }}>
      <circle cx={cx} cy={cy} r={r} fill="url(#rollMetal)" stroke={stroke} strokeWidth={2} />
      <line x1={cx} y1={cy - cross} x2={cx} y2={cy + cross} stroke={stroke} strokeWidth={1.5} /><line x1={cx - cross} y1={cy} x2={cx + cross} y2={cy} stroke={stroke} strokeWidth={1.5} />
    </g>);
  const tag = (x: number, y: number, label: string, val: string, bad: boolean, anchor: 'start' | 'end' = 'start') => (
    <g>
      <text x={x} y={y} fill="#8b9bb0" fontSize={8.5} textAnchor={anchor}>{label}</text>
      <text x={x} y={y + 13} fill={bad ? '#ff4d5e' : '#e6edf5'} fontSize={12.5} fontWeight={700} textAnchor={anchor} className={bad ? 'blink' : ''}>{val}</text>
    </g>);
  const rim = phase === 'cobble' ? '#ff4d5e' : phase === 'heavy' ? '#f5a524' : '#a8f1dc';
  return (
    <div>
      <div className="row" style={{ marginBottom: '.5rem', justifyContent: 'space-between' }}>
        <div><div className="muted" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>Physical process digital twin</div>
          <b>{title ?? '4-high roughing stand'}</b></div>
        <span className={`phase ${phase}`}>{PHASE_LABEL[phase]}</span>
      </div>
      <div className="twin">
        <svg viewBox="0 0 520 210" role="img" aria-label={`Rolling stand: ${PHASE_LABEL[phase]}`}>
          <defs>
            <linearGradient id="steelBar" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#f97316" /><stop offset="50%" stopColor="#fb923c" /><stop offset="100%" stopColor="#facc15" /></linearGradient>
            <linearGradient id="rollMetal" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#475569" /><stop offset="100%" stopColor="#1e293b" /></linearGradient>
          </defs>
          <g stroke="rgba(168,241,220,0.06)"><line x1="0" y1="50" x2="520" y2="50" /><line x1="0" y1="105" x2="520" y2="105" /><line x1="0" y1="160" x2="520" y2="160" /><line x1="130" y1="0" x2="130" y2="210" /><line x1="260" y1="0" x2="260" y2="210" /><line x1="390" y1="0" x2="390" y2="210" /></g>

          <g className={shake} style={{ animationPlayState: run }}>
            <rect x="195" y="12" width="130" height="186" rx="10" fill="none" stroke={rim} strokeWidth="4" opacity={phase === 'stable' ? 0.45 : 1} />
            <rect x="210" y="18" width="100" height="174" rx="6" fill="#0f172a" stroke="#475569" strokeWidth="1.5" />
            {[235, 285].map((x) => (
              <path key={x} d={`M${x} ${26 - 20 * force} L${x} 26 M${x - 5} 20 L${x} 27 L${x + 5} 20`} stroke={forceColor} strokeWidth={2.5 + (force > 0.8 ? 1.5 : 0)} strokeLinecap="round" fill="none" />))}
            {roll(260, 48, 22, false, '#94a3b8', 20)}
            {roll(260, 84, 14, true, '#a8f1dc', 13)}
            {phase === 'cobble'
              ? <path d="M 15 104 L 258 104 Q 292 62 315 106 T 365 68 T 415 128 L 445 105" fill="none" stroke="#f43f5e" strokeWidth="7" strokeLinecap="round" className="blink" />
              : <path d="M 15 101 L 260 101 L 505 102.5 L 505 107.5 L 260 109 L 15 109 Z" fill="url(#steelBar)" />}
            <rect x="20" y="112" width="170" height="6" rx="2" fill="#334155" /><rect x="330" y="112" width="170" height="6" rx="2" fill="#334155" />
            {roll(260, 126, 14, false, '#a8f1dc', 13)}
            {roll(260, 162, 22, true, '#94a3b8', 20)}
          </g>
          <text x="40" y="100" fill="#8b9bb0" fontSize="8">ENTRY →</text><text x="455" y="100" fill="#8b9bb0" fontSize="8">→ EXIT</text>

          {tag(12, 14, 'MOTOR SPEED', `${v('motor_speed').toFixed(0)} rpm`, ratio('motor_speed') < 0.92)}
          {tag(12, 150, 'MOTOR CURRENT', `${v('motor_current').toFixed(0)} A`, ratio('motor_current') > 1.5)}
          {tag(12, 180, 'TORQUE', `${v('torque').toFixed(1)} kNm`, ratio('torque') > 1.5)}
          {tag(508, 14, 'ROLLING FORCE', `${v('rolling_force').toFixed(0)} kN`, ratio('rolling_force') > 1.4, 'end')}
          {tag(508, 150, 'VIBRATION', `${v('vibration').toFixed(1)} mm/s`, v('vibration') > 4, 'end')}
          {tag(508, 180, 'TEMPERATURE', `${v('temperature').toFixed(0)} °C`, false, 'end')}
        </svg>
      </div>
    </div>
  );
}
