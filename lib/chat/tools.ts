/**
 * Read-only, parameterised query tools exposed to the chat agent. The LLM can only call these (never raw SQL),
 * arguments are validated/clamped, and results are small JSON documents.
 */
import { q } from '../db';
import { MILLS, SIGNAL_IDS } from '../signals';
import { KIND_PLAIN, SIGNAL_PLAIN, plainWhy } from './plain';

const KINDS = Object.keys(KIND_PLAIN);
const SEVS = ['critical', 'warning'];
const num = (v: any, d: number | undefined, lo: number, hi: number) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
const mill = (v: any) => ((MILLS as readonly string[]).includes(v) ? (v as string) : null);
const since = (hours: any) => { const h = num(hours, undefined, 0.02, 24 * 30); return h ? new Date(Date.now() - h * 3600_000) : null; };

export const TOOL_DEFS = [
  { name: 'get_alert_summary', description: 'Counts of alerts (by type, severity and mill) plus the most recent alert, optionally limited to the last N hours and/or one mill. Use for "how many", "which mill", "any alerts today".',
    input_schema: { type: 'object', properties: { mill: { type: 'string', enum: [...MILLS] }, hours: { type: 'number', description: 'look-back window in hours; omit for everything recorded' } } } },
  { name: 'list_alerts', description: 'List individual alerts with plain-language reason, duration and early-warning lead time. Filter by mill, type, severity, look-back hours.',
    input_schema: { type: 'object', properties: { mill: { type: 'string', enum: [...MILLS] }, kind: { type: 'string', enum: KINDS }, severity: { type: 'string', enum: SEVS },
      hours: { type: 'number' }, limit: { type: 'integer', description: 'default 5, max 20' }, order: { type: 'string', enum: ['newest', 'oldest', 'strongest'] } } } },
  { name: 'get_alert_details', description: 'Full detail of one alert by its numeric id: what changed, by how much, how long it lasted, whether an early warning preceded it.',
    input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  { name: 'get_signal_stats', description: 'Statistics (average, lowest, highest) of one sensor signal on one mill over the last N minutes, split into normal periods vs during-alert periods.',
    input_schema: { type: 'object', properties: { mill: { type: 'string', enum: [...MILLS] }, signal: { type: 'string', enum: SIGNAL_IDS }, minutes: { type: 'integer', description: 'default 15, max 10080' } }, required: ['mill', 'signal'] } },
  { name: 'get_current_status', description: 'Right-now status of a mill: latest sensor values and whether an alert is active.',
    input_schema: { type: 'object', properties: { mill: { type: 'string', enum: [...MILLS] } } } },
] as const;

function shape(r: any) {
  const d = r.details ?? {}, lead = d._lead;
  return {
    id: r.id, mill: r.mill_id, kind: r.kind, kind_plain: KIND_PLAIN[r.kind] ?? r.kind, severity: r.severity, status: r.status,
    started_at: new Date(r.start_ts).toISOString(), duration_seconds: +((new Date(r.end_ts).getTime() - new Date(r.start_ts).getTime()) / 1000).toFixed(1),
    signals_involved: (r.signals as string[]).map((s) => SIGNAL_PLAIN[s] ?? s), why: plainWhy(r.kind, d),
    ...(lead ? { early_warning_alert_id: lead.precursor_alert_id, early_warning_lead_seconds: lead.lead_time_s } : {}),
  };
}

export type ToolResult = Record<string, any>;
export async function runTool(name: string, a: any = {}): Promise<ToolResult> {
  switch (name) {
    case 'get_alert_summary': {
      const m = mill(a.mill), s = since(a.hours);
      const where = `($1::text IS NULL OR mill_id=$1) AND ($2::timestamptz IS NULL OR start_ts>=$2)`, p = [m, s];
      const [tot] = await q(`SELECT count(*)::int total, min(start_ts) first_ts FROM alerts WHERE ${where}`, p);
      const by = async (col: string) => Object.fromEntries((await q(`SELECT ${col} k, count(*)::int n FROM alerts WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`, p)).map((r: any) => [r.k, r.n]));
      const latest = await q(`SELECT * FROM alerts WHERE ${where} ORDER BY start_ts DESC LIMIT 1`, p);
      return { filter: { mill: m, last_hours: s ? +num(a.hours, 0, 0, 1e4)! : null }, total_alerts: tot.total, by_type: Object.fromEntries(Object.entries(await by('kind')).map(([k, n]) => [KIND_PLAIN[k] ?? k, n])),
        by_severity: await by('severity'), by_mill: await by('mill_id'), latest_alert: latest[0] ? shape(latest[0]) : null };
    }
    case 'list_alerts': {
      const lim = num(a.limit, 5, 1, 20), order = a.order === 'oldest' ? 'start_ts ASC' : a.order === 'strongest' ? 'score DESC, start_ts DESC' : 'start_ts DESC';
      const rows = await q(`SELECT * FROM alerts WHERE ($1::text IS NULL OR mill_id=$1) AND ($2::text IS NULL OR kind=$2) AND ($3::text IS NULL OR severity=$3) AND ($4::timestamptz IS NULL OR start_ts>=$4) ORDER BY ${order} LIMIT $5`,
        [mill(a.mill), KINDS.includes(a.kind) ? a.kind : null, SEVS.includes(a.severity) ? a.severity : null, since(a.hours), lim]);
      return { count: rows.length, alerts: rows.map(shape) };
    }
    case 'get_alert_details': {
      const [r] = await q('SELECT * FROM alerts WHERE id=$1', [Math.trunc(+a.id) || 0]);
      if (!r) return { error: `No alert with id ${a.id}` };
      const dev = Object.entries(r.details ?? {}).filter(([k, v]: any) => !k.startsWith('_') && Math.abs(v.pct) >= 3 && Math.abs(v.z) >= 4)
        .map(([k, v]: any) => ({ signal: SIGNAL_PLAIN[k] ?? k, normal: +v.baseline.toFixed(1), at_worst: +v.peak.toFixed(1), change_percent: +v.pct.toFixed(0) }));
      return { ...shape(r), what_changed: dev };
    }
    case 'get_signal_stats': {
      const m = mill(a.mill) ?? MILLS[0], sig = SIGNAL_IDS.includes(a.signal) ? a.signal : null;
      if (!sig) return { error: 'unknown signal' };
      const mins = num(a.minutes, 15, 1, 10080)!, from = new Date(Date.now() - mins * 60_000);
      const rows = await q(`WITH r AS (SELECT ro.*, EXISTS (SELECT 1 FROM alerts a WHERE a.mill_id=ro.mill_id AND ro.bucket BETWEEN a.start_ts - interval '8 seconds' AND a.end_ts + interval '3 seconds') ab
          FROM rollup_1s ro WHERE mill_id=$1 AND signal=$2 AND bucket>=$3)
        SELECT ab, sum(avg*n)/NULLIF(sum(n),0) mean, min(min) lo, max(max) hi, sum(n)::int samples FROM r GROUP BY ab`, [m, sig, from]);
      const g = (ab: boolean) => { const x = rows.find((r: any) => r.ab === ab); return x ? { average: +(+x.mean).toFixed(1), lowest: +(+x.lo).toFixed(1), highest: +(+x.hi).toFixed(1) } : null; };
      return { mill: m, signal: SIGNAL_PLAIN[sig], window_minutes: mins, normal_periods: g(false), during_alerts: g(true) };
    }
    case 'get_current_status': {
      const m = mill(a.mill) ?? MILLS[0];
      const [last] = await q(`SELECT max(ts) ts FROM readings WHERE mill_id=$1 AND signal='motor_current'`, [m]);
      if (!last?.ts) return { mill: m, status: 'no data yet' };
      const lv = await q(`SELECT DISTINCT ON (signal) signal, value FROM readings WHERE mill_id=$1 AND ts>$2 ORDER BY signal, ts DESC`, [m, new Date(new Date(last.ts).getTime() - 2000)]);
      const act = await q(`SELECT * FROM alerts WHERE mill_id=$1 AND end_ts > $2 ORDER BY start_ts DESC LIMIT 1`, [m, new Date(new Date(last.ts).getTime() - 30_000)]);
      return { mill: m, last_reading_at: new Date(last.ts).toISOString(), data_is_stale: Date.now() - new Date(last.ts).getTime() > 15_000,
        status: act[0] ? (act[0].severity === 'critical' ? 'SERIOUS ALERT active' : 'warning active') : 'normal',
        latest_values: Object.fromEntries(lv.map((l: any) => [SIGNAL_PLAIN[l.signal] ?? l.signal, +(+l.value).toFixed(1)])), active_alert: act[0] ? shape(act[0]) : null };
    }
    default: return { error: `unknown tool ${name}` };
  }
}
