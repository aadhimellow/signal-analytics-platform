import '../scripts/env';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema, pool, q } from '../lib/db';
import { registerUser, checkLogin, normalizeCode } from '../lib/auth';

after(() => pool.end());
const skip = !process.env.DATABASE_URL && 'no DATABASE_URL';
const tag = Date.now().toString(36).toUpperCase();
const C = (n: number) => `TEST-${tag}-${n}`;

test('signup requires a valid, active, unused employee code', { skip }, async (t) => {
  await ensureSchema();
  for (let i = 1; i <= 3; i++) await q('INSERT INTO employees(employee_code, full_name) VALUES($1,$2)', [C(i), 'Test ' + i]);
  await q('UPDATE employees SET is_active=false WHERE employee_code=$1', [C(3)]);
  t.after(async () => { await q('DELETE FROM users WHERE email LIKE $1', [`%${tag.toLowerCase()}@test.dev`]); await q('DELETE FROM employees WHERE employee_code LIKE $1', [`TEST-${tag}-%`]); });
  const em = (n: string) => `${n}${tag.toLowerCase()}@test.dev`;

  assert.deepEqual(await registerUser(em('a'), 'Passw0rd!', 'NOPE-0000'), { ok: false, reason: 'bad_code' });           // unknown
  assert.deepEqual(await registerUser(em('b'), 'Passw0rd!', C(3)), { ok: false, reason: 'bad_code' });                  // deactivated
  const ok = await registerUser(em('c'), 'Passw0rd!', C(1)); assert.equal(ok.ok, true);                                  // valid
  assert.deepEqual(await registerUser(em('d'), 'Passw0rd!', C(1)), { ok: false, reason: 'bad_code' });                  // already used
  assert.deepEqual(await registerUser(em('c'), 'Passw0rd!', C(2)), { ok: false, reason: 'email_taken' });               // email taken ...
  assert.equal((await registerUser(em('e'), 'Passw0rd!', C(2))).ok, true);                                              // ... and C(2) was NOT burned
  assert.ok(await checkLogin(em('c'), 'Passw0rd!'));
  const [{ n }] = await q<{ n: number }>('SELECT count(*)::int n FROM users WHERE employee_code=$1', [C(1)]); assert.equal(n, 1);
});
test('concurrent signups with the same code: exactly one wins', { skip }, async (t) => {
  await ensureSchema(); const code = C(9);
  await q('INSERT INTO employees(employee_code, full_name) VALUES($1,$2)', [code, 'Race']);
  t.after(async () => { await q('DELETE FROM users WHERE email LIKE $1', [`race%${tag.toLowerCase()}@test.dev`]); await q('DELETE FROM employees WHERE employee_code=$1', [code]); });
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => registerUser(`race${i}${tag.toLowerCase()}@test.dev`, 'Passw0rd!', code)));
  assert.equal(rs.filter((r) => r.ok).length, 1);
});
test('codes are normalised', () => { assert.equal(normalizeCode('  emp-ab12 '), 'EMP-AB12'); });
