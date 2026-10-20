import './env';
import { ensureSchema, pool } from '../lib/db';
ensureSchema().then(() => { console.log('schema ready'); return pool.end(); });
