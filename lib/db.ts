import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const g = globalThis as unknown as { _pool?: Pool };
export const pool: Pool =
  g._pool ??
  (g._pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 5),
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  }));

export const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);

let initialised: Promise<void> | null = null;
/** Idempotent schema bootstrap so a fresh Vercel + Neon deployment works without a manual migration step. */
export function ensureSchema(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    return Promise.reject(new Error('DATABASE_URL is not set. Copy .env.example to .env.local (in the folder containing package.json) and restart.'));
  }
  return (initialised ??= (async () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);
  })().catch((e) => { initialised = null; throw e; }));
}
