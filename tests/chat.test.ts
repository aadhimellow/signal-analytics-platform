import test from 'node:test';
import assert from 'node:assert/strict';
import { answerWithLLM, answerWithRules } from '../lib/chat/agent';
import { plainWhy, ago, safeTz } from '../lib/chat/plain';

const ALERT = { id: 12, mill: 'RM-01', kind: 'cobble_signature', kind_plain: 'Cobble (the steel strip jammed in the mill)', severity: 'critical', started_at: new Date(Date.now() - 240_000).toISOString(),
  duration_seconds: 2.8, why: 'Motor power draw rose 147%.', early_warning_lead_seconds: 7.8, early_warning_alert_id: 11, what_changed: [{ signal: 'machine vibration', normal: 2, at_worst: 11, change_percent: 450 }] };
const exec = async (name: string, a: any) => name === 'list_alerts' ? { count: 1, alerts: [ALERT] } : name === 'get_alert_details' ? (a.id === 12 ? ALERT : { error: 'none' }) : { total_alerts: 0 };

/*test('LLM mode: runs the tool loop, returns final text and the alert cards from tool results', async () => {
  const seen: any[] = [];
  const script = [
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'tu_1', name: 'list_alerts', input: { limit: 1 } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'The latest alert is #12, a cobble 4 minutes ago.' }] },
  ];
  let i = 0;
  const r = await answerWithLLM([{ role: 'user', content: 'latest alert?' }], 'UTC', exec, async (body) => { seen.push(JSON.parse(JSON.stringify(body))); return script[i++]; });
  assert.equal(r.mode, 'llm'); assert.match(r.reply, /#12/); assert.equal(r.alerts[0].id, 12);
  assert.equal(seen[0].tools.length, 5);
  const toolMsg = seen[1].messages.at(-1);                        // second call must carry the tool_result back
  assert.equal(toolMsg.content[0].type, 'tool_result'); assert.equal(toolMsg.content[0].tool_use_id, 'tu_1');
  assert.match(seen[0].system, /plain|Never guess/i);
});
test('LLM mode: a tool error is passed to the model, not thrown', async () => {
  let i = 0;
  const r = await answerWithLLM([{ role: 'user', content: 'x' }], 'UTC', async () => { throw new Error('db down'); },
    async () => (i++ === 0 ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'get_alert_summary', input: {} }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Could not check.' }] }));
  assert.equal(r.reply, 'Could not check.');
});
test('LLM mode: gives up after 5 tool rounds instead of looping forever', async () => {
  await assert.rejects(answerWithLLM([{ role: 'user', content: 'x' }], 'UTC', exec, async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'list_alerts', input: {} }] })));
});
*/
test('LLM mode: runs the tool loop, returns final text and the alert cards from tool results', async () => {
  const seen: any[] = [];
  const script = [
    { candidates: [{ content: { role: 'model', parts: [{ text: 'Checking.' }, { functionCall: { name: 'list_alerts', args: { limit: 1 } } }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'The latest alert is #12, a cobble 4 minutes ago.' }] } }] },
  ];
  let i = 0;
  const r = await answerWithLLM([{ role: 'user', content: 'latest alert?' }], 'UTC', exec, async (body) => { seen.push(JSON.parse(JSON.stringify(body))); return script[i++]; });
  assert.equal(r.mode, 'llm'); assert.match(r.reply, /#12/); assert.equal(r.alerts[0].id, 12);
  assert.equal(seen[0].tools[0].functionDeclarations.length, 5);
  const toolMsg = seen[1].contents.at(-1);                        // second call must carry the functionResponse back
  assert.ok(toolMsg.parts[0].functionResponse); assert.equal(toolMsg.parts[0].functionResponse.name, 'list_alerts');
  assert.match(seen[0].systemInstruction.parts[0].text, /plain|Never guess/i);
});
test('LLM mode: a tool error is passed to the model, not thrown', async () => {
  let i = 0;
  const r = await answerWithLLM([{ role: 'user', content: 'x' }], 'UTC', async () => { throw new Error('db down'); },
    async () => (i++ === 0
      ? { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_alert_summary', args: {} } }] } }] }
      : { candidates: [{ content: { role: 'model', parts: [{ text: 'Could not check.' }] } }] }));
  assert.equal(r.reply, 'Could not check.');
});
test('LLM mode: gives up after 5 tool rounds instead of looping forever', async () => {
  await assert.rejects(answerWithLLM([{ role: 'user', content: 'x' }], 'UTC', exec,
    async () => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'list_alerts', args: {} } }] } }] })));
});
test('rules: latest alert in plain words, with the card and lead time', async () => {
  const r = await answerWithRules([{ role: 'user', content: 'What was the latest alert and why did it happen?' }], 'UTC', exec);
  assert.match(r.reply, /#12/); assert.match(r.reply, /warned about it 7\.8 seconds/); assert.equal(r.alerts.length, 1); assert.equal(r.mode, 'rules');
});
test('rules: "explain this" after an answer that mentioned #12 resolves the reference', async () => {
  const r = await answerWithRules([{ role: 'user', content: 'latest alert' }, { role: 'assistant', content: 'The latest alert is **#12**' }, { role: 'user', content: 'Explain this alert in simple terms' }], 'UTC', exec);
  assert.match(r.reply, /Alert #12/); assert.match(r.reply, /What changed/);
});
test('rules: unknown alert id and off-topic questions are handled politely', async () => {
  assert.match((await answerWithRules([{ role: 'user', content: 'explain alert 999' }], 'UTC', exec)).reply, /could not find alert #999/);
  const off = await answerWithRules([{ role: 'user', content: 'what is the weather in paris' }], 'UTC', exec);
  assert.match(off.reply, /alerts and sensor history/); assert.equal(off.followups.length, 3);
});
test('plain helpers', () => {
  assert.match(plainWhy('cobble_precursor', { vibration: { pct: 180, z: 15 }, torque: { pct: 16, z: 3 }, motor_speed: { pct: -6, z: -1.5 } }), /vibration rose 180%.*speed dropped 6%.*no sudden jump/);
  assert.equal(ago(new Date(Date.now() - 125_000)), '2 minutes ago'); assert.equal(safeTz('Not/AZone'), 'UTC'); assert.equal(safeTz('Asia/Kolkata'), 'Asia/Kolkata');
});
