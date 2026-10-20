/**
 * External PLC simulator / replayer. Sends 20 ms readings to POST /api/ingest in 1 s batches.
 *   npm run simulate -- --url http://localhost:3000 --key dev-ingest-key --mill RM-01
 *   npm run simulate -- --replay-from 2026-10-19T10:00:00Z --replay-to 2026-10-19T10:10:00Z --speed 10   (replay history)
 * Set EMBEDDED_SIMULATOR=false on the server when using this, otherwise both producers write the same mill.
 */
import './env';
import { generate } from '../lib/simulator';

const a = (n: string, d?: string) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const url = (a('url', 'http://localhost:3000') as string).replace(/\/$/, '');
const key = a('key', process.env.INGEST_API_KEY || 'dev-ingest-key') as string;
const mills = (a('mill', 'RM-01,RM-02') as string).split(',');
const speed = Number(a('speed', '1'));
const rf = a('replay-from'), rt = a('replay-to');

async function post(readings: unknown[]) {
  const r = await fetch(`${url}/api/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ readings }) });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j;
}
(async () => {
  const replay = !!rf;
  let cursor = replay ? Date.parse(rf!) : Math.floor(Date.now() / 1000) * 1000;
  const end = replay ? Date.parse(rt ?? new Date().toISOString()) : Infinity;
  console.log(replay ? `replaying ${rf} -> ${rt} at x${speed}` : 'live simulation (20 ms sampling), Ctrl+C to stop');
  while (cursor < end) {
    const t0 = Date.now(), next = Math.min(cursor + 1000, end);
    const readings = mills.flatMap((m) => generate(m, cursor, next));
    const res = await post(readings);
    console.log(new Date(cursor).toISOString(), `sent=${readings.length} inserted=${res.inserted} newAlerts=${res.alerts}`);
    cursor = next;
    const wait = 1000 / speed - (Date.now() - t0); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
})();
