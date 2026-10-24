/** Plain-language helpers: turn internal names, numbers and times into words a floor worker or visiting manager understands. */
export const KIND_PLAIN: Record<string, string> = {
  cobble_signature: 'Cobble (the steel strip jammed in the mill)',
  cobble_precursor: 'Early warning (a jam may be developing)',
  signal_outlier: 'Single sensor reading out of range',
};
export const KIND_SHORT: Record<string, string> = { cobble_signature: 'cobble', cobble_precursor: 'early warning', signal_outlier: 'sensor outlier' };
export const SIGNAL_PLAIN: Record<string, string> = {
  motor_speed: 'motor speed', motor_current: 'motor power draw (current)', torque: 'motor twisting force (torque)',
  rolling_force: 'pressing force on the steel', vibration: 'machine vibration', temperature: 'temperature',
};
export const sevPlain = (s: string) => (s === 'critical' ? 'serious' : s);

export function safeTz(tz?: string): string { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz || 'UTC'; } catch { return 'UTC'; } }
export function fmtTime(d: Date | string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(d));
}
export function ago(d: Date | string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
  if (s < 10) return 'just now'; if (s < 90) return `${s} seconds ago`;
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`; if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
export function dur(sec: number): string { return sec < 90 ? `${sec.toFixed(1)} seconds` : `${(sec / 60).toFixed(1)} minutes`; }

/** One sentence on why an alert was raised, from the stored per-signal deviations. */
export function plainWhy(kind: string, details: Record<string, any>): string {
  const pick = kind === 'cobble_signature' ? ['motor_current', 'torque', 'motor_speed', 'rolling_force', 'vibration']
    : kind === 'cobble_precursor' ? ['vibration', 'torque', 'motor_speed'] : Object.keys(details).filter((k) => !k.startsWith('_') && Math.abs(details[k]?.z ?? 0) >= 8);
  const parts = pick.filter((k) => details[k] && Math.abs(details[k].pct) >= 3).map((k) => {
    const p = details[k].pct; return `${SIGNAL_PLAIN[k] ?? k} ${p >= 0 ? 'rose' : 'dropped'} ${Math.abs(p).toFixed(0)}%`;
  });
  if (!parts.length) return 'Readings moved well outside their normal range.';
  const tail = kind === 'cobble_precursor' ? ', with no sudden jump in power draw - the pattern of rolls slipping or chattering before a jam'
    : kind === 'cobble_signature' ? ', all at the same moment - the typical signature of a jam' : '';
  return `Compared with the previous 10 seconds, ${parts.join(', ')}${tail}.`;
}
