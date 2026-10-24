export const MILLS = ['RM-01', 'RM-02'] as const;
export const SAMPLE_MS = 20;

export const SIGNALS = [
  { id: 'motor_speed', label: 'Motor speed', unit: 'rpm', color: '#4cc9f0' },
  { id: 'motor_current', label: 'Motor current', unit: 'A', color: '#f72585' },
  { id: 'torque', label: 'Torque', unit: 'kNm', color: '#f8961e' },
  { id: 'rolling_force', label: 'Rolling force', unit: 'kN', color: '#90be6d' },
  { id: 'vibration', label: 'Vibration', unit: 'mm/s', color: '#b5179e' },
  { id: 'temperature', label: 'Temperature', unit: '°C', color: '#ffd166' },
] as const;
export type SignalId = (typeof SIGNALS)[number]['id'];
export const SIGNAL_IDS = SIGNALS.map((s) => s.id) as SignalId[];
export const SIGNAL_META = Object.fromEntries(SIGNALS.map((s) => [s.id, s])) as Record<string, (typeof SIGNALS)[number]>;

/** Nominal operating point per signal; used by the digital twin to turn raw values into load ratios. */
export const NOMINAL: Record<SignalId, number> = {
  motor_speed: 600, motor_current: 400, torque: 12, rolling_force: 2500, vibration: 2, temperature: 78,
};
export type Phase = 'stable' | 'heavy' | 'precursor' | 'cobble';
/**
 * Visual process phase derived ONLY from signal values (never from a scenario flag), so the twin shows what the
 * data says. The alert itself always comes from the detector (lib/detector.ts).
 */
export function phaseOf(v: Partial<Record<string, number>>): Phase {
  const r = (id: SignalId) => (v[id] ?? NOMINAL[id]) / NOMINAL[id];
  if (r('motor_current') > 1.5 && r('torque') > 1.5 && (r('motor_speed') < 0.92 || r('vibration') > 1.5)) return 'cobble';
  if (r('vibration') > 1.7 && r('motor_speed') < 0.97 && r('torque') > 1.08) return 'precursor'; // slip/chatter: vibration up, speed sagging
  if (r('motor_speed') > 1.08) return 'heavy';
  return 'stable';
}
