/**
 * Manage employee codes.
 *   npm run employees -- list
 *   npm run employees -- add "Full Name" "Department" [CODE]     (a random code is generated if omitted)
 *   npm run employees -- deactivate CODE        npm run employees -- activate CODE
 */
import './env';
import { randomInt } from 'node:crypto';
import { ensureSchema, pool, q } from '../lib/db';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const gen = () => 'EMP-' + Array.from({ length: 6 }, () => ALPHA[randomInt(ALPHA.length)]).join('');

(async () => {
  await ensureSchema();
  const [cmd = 'list', a, b, c] = process.argv.slice(2);
  if (cmd === 'add') {
    if (!a) throw new Error('usage: add "Full Name" "Department" [CODE]');
    const code = (c ?? gen()).toUpperCase();
    await q('INSERT INTO employees(employee_code, full_name, department) VALUES($1,$2,$3)', [code, a, b ?? null]);
    console.log(`added ${code} for ${a}`);
  } else if (cmd === 'deactivate' || cmd === 'activate') {
    const r = await pool.query('UPDATE employees SET is_active=$2 WHERE employee_code=$1', [a?.toUpperCase(), cmd === 'activate']);
    console.log(r.rowCount ? `${cmd}d ${a}` : 'no such code');
  }
  console.table(await q(`SELECT e.employee_code AS code, e.full_name AS name, e.department, e.is_active AS active, u.email AS used_by
                         FROM employees e LEFT JOIN users u ON u.employee_code = e.employee_code ORDER BY e.created_at, e.employee_code`));
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
