/** Ingestion -> rollups -> anomaly detection -> alert persistence, plus the embedded virtual-PLC driver. */
import { pool, q } from './db';
import { Reading, generate, ManualEvent, PRE_MS } from './simulator';
import { detect, WINDOW_MS, WindowSeries, DetectedIncident } from './detector';
import { MILLS, SIGNAL_IDS, SignalId } from './signals';

const CHUNK = 20_000;

/** Bulk, idempotent insert (ON CONFLICT DO NOTHING) using unnest arrays. Returns rows actually inserted. */
export async function insertReadings(rows: Reading[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const c = rows.slice(i, i + CHUNK);
    const r = await pool.query(
      `INSERT INTO readings(mill_id,signal,ts,value,unit,quality)
       SELECT * FROM unnest($1::text[],$2::text[],$3::timestamptz[],$4::float8[],$5::text[],$6::int2[])
       ON CONFLICT DO NOTHING`,
      [c.map((x) => x.mill_id), c.map((x) => x.signal), c.map((x) => x.timestamp), c.map((x) => x.value), c.map((x) => x.unit), c.map((x) => x.quality)],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

/** (Re)compute 1 s rollups for whole seconds in [from,to). */
export async function rollup(mill: string, fromMs: number, toMs: number) {
  const f = new Date(Math.floor(fromMs / 1000) * 1000), t = new Date(Math.floor(toMs / 1000) * 1000);
  if (t <= f) return;
  await pool.query(
    `INSERT INTO rollup_1s(mill_id,signal,bucket,avg,min,max,std,n)
     SELECT mill_id,signal,date_trunc('second',ts),avg(value),min(value),max(value),COALESCE(stddev_samp(value),0),count(*)
     FROM readings WHERE mill_id=$1 AND ts>=$2 AND ts<$3 GROUP BY 1,2,3
     ON CONFLICT (mill_id,signal,bucket) DO UPDATE SET avg=EXCLUDED.avg,min=EXCLUDED.min,max=EXCLUDED.max,std=EXCLUDED.std,n=EXCLUDED.n`,
    [mill, f, t],
  );
}

/** Run the detector over [fromMs,toMs] (plus 12 s of baseline context) and persist new/extended alerts. */
export async function detectRange(mill: string, fromMs: number, toMs: number): Promise<number> {
  const ctx = 12_000;
  const rows = await q<{ signal: SignalId; b: string; v: number; n: number }>(
    `SELECT signal, floor(extract(epoch from ts)*1000/$4)::bigint AS b, avg(value) AS v, count(*)::int AS n
     FROM readings WHERE mill_id=$1 AND ts>=$2 AND ts<$3 GROUP BY 1,2 ORDER BY 2`,
    [mill, new Date(fromMs - ctx), new Date(toMs), WINDOW_MS],
  );
  if (!rows.length) return 0;
  const buckets = [...new Set(rows.map((r) => Number(r.b)))].sort((a, b) => a - b);
  const idx = new Map(buckets.map((b, i) => [b, i]));
  const w = Object.fromEntries(SIGNAL_IDS.map((s) => [s, new Array(buckets.length).fill(NaN)])) as unknown as WindowSeries;
  for (const r of rows) w[r.signal][idx.get(Number(r.b))!] = Number(r.v);
  // forward-fill gaps so a missing window cannot poison the baseline
  for (const s of SIGNAL_IDS) for (let i = 0; i < w[s].length; i++) if (Number.isNaN(w[s][i])) w[s][i] = i ? w[s][i - 1] : 0;
  const found = detect(w).filter((i) => (buckets[i.endIdx] + 1) * WINDOW_MS > fromMs); // only incidents touching the new range
  let saved = 0;
  for (const inc of found) saved += await saveIncident(mill, inc, buckets[inc.startIdx] * WINDOW_MS, (buckets[inc.endIdx] + 1) * WINDOW_MS);
  return saved;
}

/** For a cobble, look back 60 s for a precursor warning on the same mill and record the lead time. */
async function withLead(mill: string, inc: DetectedIncident, startMs: number) {
  let reason = inc.reason; const details: any = { ...inc.details };
  if (inc.kind === 'cobble_signature') {
    const [pre] = await q<{ id: number; start_ts: Date }>(
      `SELECT id,start_ts FROM alerts WHERE mill_id=$1 AND kind='cobble_precursor' AND start_ts<=$2 AND start_ts>=$3 ORDER BY start_ts DESC LIMIT 1`,
      [mill, new Date(startMs), new Date(startMs - 60_000)]);
    if (pre) {
      const lead = (startMs - pre.start_ts.getTime()) / 1000;
      details._lead = { precursor_alert_id: pre.id, lead_time_s: +lead.toFixed(1) };
      reason += ` Early warning (alert #${pre.id}) fired ${lead.toFixed(1)} s earlier.`;
    }
  }
  return { reason, details };
}

/** Insert an alert, or extend an existing one for the same mill/kind/signals that overlaps or is within 10 s. */
async function saveIncident(mill: string, inc: DetectedIncident, startMs: number, endMs: number): Promise<number> {
  const [ex] = await q<{ id: number; start_ts: Date }>(
    `SELECT id, start_ts FROM alerts WHERE mill_id=$1 AND kind=$2 AND signals && $3::text[] AND start_ts <= $5 AND end_ts >= $4 ORDER BY id LIMIT 1`,
    [mill, inc.kind, inc.signals, new Date(startMs - 10_000), new Date(endMs + 10_000)],
  );
  if (ex) {
    const { reason, details } = await withLead(mill, inc, Math.min(startMs, ex.start_ts.getTime()));
    await pool.query(
      `UPDATE alerts SET start_ts=LEAST(start_ts,$2), end_ts=GREATEST(end_ts,$3), score=GREATEST(score,$4), details=$5, reason=$6 WHERE id=$1`,
      [ex.id, new Date(startMs), new Date(endMs), inc.score, JSON.stringify(details), reason],
    );
    return 0;
  }
  const { reason, details } = await withLead(mill, inc, startMs);
  await pool.query(
    `INSERT INTO alerts(mill_id,kind,severity,start_ts,end_ts,signals,reason,score,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [mill, inc.kind, inc.severity, new Date(startMs), new Date(endMs), inc.signals, reason, inc.score, JSON.stringify(details)],
  );
  return 1;
}

/** Full ingestion pipeline for a batch received from any producer (external simulator, replay, real PLC gateway). */
export async function ingestBatch(rows: Reading[]) {
  const inserted = await insertReadings(rows);
  const byMill = new Map<string, number[]>();
  for (const r of rows) (byMill.get(r.mill_id) ?? byMill.set(r.mill_id, []).get(r.mill_id)!).push(Date.parse(r.timestamp));
  let alerts = 0;
  for (const [mill, ts] of byMill) {
    const lo = Math.min(...ts), hi = Math.max(...ts) + 1;
    await rollup(mill, lo, hi);
    alerts += await detectRange(mill, lo, hi);
  }
  return { inserted, alerts };
}

// ------------------------------------------------------------------ embedded virtual PLC (serverless friendly)
const MAX_CATCHUP_MS = 120_000;

async function manualEvents(mill: string, fromMs: number, toMs: number): Promise<ManualEvent[]> {
  const rows = await q<{ start_ts: Date; kind: string }>(`SELECT start_ts, kind FROM scenario_events WHERE mill_id=$1 AND start_ts>=$2 AND start_ts<$3`, [mill, new Date(fromMs - 30_000), new Date(toMs)]);
  return rows.flatMap((r): ManualEvent[] => {
    const t = r.start_ts.getTime();
    if (r.kind === 'precursor') return [{ kind: 'precursor', startMs: t, fade: true }];            // near miss
    if (r.kind === 'escalation') return [{ kind: 'precursor', startMs: t, fade: false }, { kind: 'cobble', startMs: t + PRE_MS }];
    return [{ kind: 'cobble', startMs: t }];
  });
}

/**
 * Lazily advances the virtual PLC up to "now". Whoever calls first (a dashboard poll, a cron hit) generates the
 * samples since the stored cursor, persists them and runs detection. An advisory lock makes concurrent
 * serverless invocations safe. Visitors being absent simply leaves a gap in history (like a real outage).
 */
export async function advanceSimulator(): Promise<{ advanced: boolean }> {
  if (process.env.EMBEDDED_SIMULATOR === 'false') return { advanced: false };
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(424242) AS ok');
    if (!rows[0].ok) return { advanced: false };
    try {
      const now = Math.floor((Date.now() - 500) / 20) * 20; // stay half a second behind wall-clock
      for (const mill of MILLS) {
        const st = await client.query('SELECT cursor_ts FROM sim_state WHERE mill_id=$1', [mill]);
        let from = st.rows[0] ? st.rows[0].cursor_ts.getTime() : now - 60_000;
        if (now - from > MAX_CATCHUP_MS) from = now - MAX_CATCHUP_MS;
        if (now - from < 1000) continue;
        const to = now;
        const rows2 = generate(mill, from, to, await manualEvents(mill, from, to));
        await insertReadings(rows2);
        await rollup(mill, from, to);
        await detectRange(mill, from, to);
        await client.query('INSERT INTO sim_state(mill_id,cursor_ts) VALUES($1,$2) ON CONFLICT (mill_id) DO UPDATE SET cursor_ts=EXCLUDED.cursor_ts', [mill, new Date(to)]);
      }
      if (Math.random() < 0.02) await prune();
      return { advanced: true };
    } finally {
      await client.query('SELECT pg_advisory_unlock(424242)');
    }
  } finally { client.release(); }
}

/** Retention: drop old raw data except ±60 s around alerts; 1 s rollups are kept for 14 days. */
export async function prune() {
  const hours = Number(process.env.RAW_RETENTION_HOURS ?? 1);
  await pool.query(
    `DELETE FROM readings r WHERE ts < now() - ($1 || ' hours')::interval
       AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.mill_id=r.mill_id AND r.ts BETWEEN a.start_ts - interval '60 seconds' AND a.end_ts + interval '60 seconds')`,
    [String(hours)],
  );
  await pool.query(`DELETE FROM rollup_1s WHERE bucket < now() - interval '14 days'`);
}
