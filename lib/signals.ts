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
