import { TOOL_DEFS, runTool, ToolResult } from './tools';
import { KIND_PLAIN, KIND_SHORT, SIGNAL_PLAIN, ago, dur, fmtTime, safeTz, sevPlain } from './plain';

export type Msg = { role: 'user' | 'assistant'; content: string };
export type AlertCard = { id: number; mill: string; kind: string; severity: string; started_at: string; duration_seconds: number; headline: string };
export type ChatReply = { reply: string; alerts: AlertCard[]; followups: string[]; mode: 'llm' | 'rules'; note?: string };
type Exec = (name: string, args: any) => Promise<ToolResult>;

export const SUGGESTIONS = [
  'What was the latest alert and why did it happen?',
  'How many alerts have we had, and which mill had more?',
  'Did we get any early warning before a cobble?',
];
//export const llmEnabled = () => !!process.env.ANTHROPIC_API_KEY;
export const llmEnabled = () => !!process.env.GEMINI_API_KEY;

const card = (a: any): AlertCard => ({ id: a.id, mill: a.mill, kind: a.kind, severity: a.severity, started_at: a.started_at, duration_seconds: a.duration_seconds, headline: KIND_SHORT[a.kind] ?? a.kind });
function collectCards(name: string, r: ToolResult, into: Map<number, AlertCard>) {
  const rows = name === 'list_alerts' ? r.alerts : name === 'get_alert_details' && r.id ? [r] : name === 'get_alert_summary' && r.latest_alert ? [r.latest_alert] : name === 'get_current_status' && r.active_alert ? [r.active_alert] : [];
  for (const a of rows ?? []) if (!into.has(a.id) && into.size < 5) into.set(a.id, card(a));
}

// ============================================================ LLM mode (Anthropic tool use)
const system = (tz: string) => `You are the Mono Edge Assistant for a steel rolling-mill monitoring system. You answer questions about this plant's ALERTS and recorded SENSOR HISTORY.
Audience: floor workers and visiting managers, not data scientists. Be brief (2-5 short sentences or a short list), friendly and concrete.
Rules:
- ALWAYS use the tools to get facts. Never guess or invent numbers, alert ids, times or causes. If tools return nothing, say plainly that nothing was recorded.
- Use plain words. Say "cobble (the steel strip jammed in the mill)" the first time. An "early warning" means the system noticed signs of a possible jam before it happened. Do not use terms like z-score, MAD, baseline or SQL unless asked.
- A legitimate load change (mill deliberately running harder) is NOT a problem; never call it a fault.
- Mention alert numbers like #12 so the person can open them. Give times in the person's timezone (${tz}); current time: ${new Date().toLocaleString('en-GB', { timeZone: tz })}. Say how long ago things happened.
- Stay on topic. If asked about anything else, say what you can help with: recent alerts, counts, causes, early warnings, and sensor history like vibration or motor power.
- Mills are RM-01 and RM-02. Seconds under 90 may stay as seconds.`;

const GEMINI_TOOLS = [{
  functionDeclarations: TOOL_DEFS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  })),
}];

async function callGemini(body: any) {
  //added fallback logic if model is wrong then gemini-3.1-flash-lite is used
  const model = process.env.LLM_MODEL || 'gemini-3.1-flash-lite';
  const key = process.env.GEMINI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}


async function callClaude(body: any) {
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const r = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function answerWithLLM(messages: Msg[], tz: string, exec: Exec = runTool, call = callGemini): Promise<ChatReply> {
  const contents: any[] = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const cards = new Map<number, AlertCard>();
  for (let round = 0; round < 5; round++) {
    const res = await call({
      systemInstruction: { parts: [{ text: system(tz) }] },
      tools: GEMINI_TOOLS,
      contents,
      generationConfig: { maxOutputTokens: 700 },
    });
    const content = res.candidates?.[0]?.content;
    if (!content?.parts?.length) {
      return { reply: 'Sorry, I could not put an answer together.', alerts: [...cards.values()], followups: followupsFor(cards), mode: 'llm' };
    }
    contents.push(content);
    const uses = (content.parts as any[]).filter((p) => p.functionCall);
    if (!uses.length) {
      const text = (content.parts as any[]).filter((p) => p.text).map((p) => p.text).join('\n').trim();
      return { reply: text || 'Sorry, I could not put an answer together.', alerts: [...cards.values()], followups: followupsFor(cards), mode: 'llm' };
    }
    const results = [];
    for (const u of uses) {
      const { name, args } = u.functionCall;
      let out: ToolResult; try { out = await exec(name, args); } catch (e: any) { out = { error: 'query failed' }; }
      collectCards(name, out, cards);
      results.push({ functionResponse: { name, response: out } });
    }
    contents.push({ role: 'user', parts: results });
  }
  throw new Error('tool loop did not finish');
}

/*export async function answerWithLLM(messages: Msg[], tz: string, exec: Exec = runTool, call = callClaude): Promise<ChatReply> {
  const convo: any[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const cards = new Map<number, AlertCard>();
  for (let round = 0; round < 5; round++) {
    const res = await call({ model: process.env.LLM_MODEL || 'claude-haiku-5-5', max_tokens: 700, system: system(tz), tools: TOOL_DEFS, messages: convo });
    convo.push({ role: 'assistant', content: res.content });
    const uses = (res.content as any[]).filter((c) => c.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      const text = (res.content as any[]).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      return { reply: text || 'Sorry, I could not put an answer together.', alerts: [...cards.values()], followups: followupsFor(cards), mode: 'llm' };
    }
    const results = [];
    for (const u of uses) {
      let out: ToolResult; try { out = await exec(u.name, u.input); } catch (e: any) { out = { error: 'query failed' }; }
      collectCards(u.name, out, cards);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
    }
    convo.push({ role: 'user', content: results });
  }
  throw new Error('tool loop did not finish');
}*/



const followupsFor = (cards: Map<number, AlertCard>): string[] =>
  cards.size ? ['Explain this alert in simple terms', 'Was there an early warning before it?', 'Show the most serious alerts'] : SUGGESTIONS.slice(0, 3);

// ============================================================ Rules mode (no API key needed; same tools)
const MILL_RE = /rm[-\s]?0?([12])|mill\s*(?:no\.?\s*)?([12])\b/i;
const SIGNAL_WORDS: [RegExp, string][] = [[/vibrat|shak/, 'vibration'], [/current|power|amp/, 'motor_current'], [/torque|twist/, 'torque'], [/speed|rpm|slow/, 'motor_speed'], [/force|press/, 'rolling_force'], [/temp|hot|heat/, 'temperature']];

function parseWindow(t: string): { hours?: number; label: string } {
  let m = t.match(/(?:last|past)\s+(\d+(?:\.\d+)?)\s*(minute|min|hour|hr|day)s?/);
  if (m) { const n = +m[1], u = m[2]; const h = u.startsWith('min') ? n / 60 : u.startsWith('h') ? n : n * 24; return { hours: h, label: `in the last ${n} ${u.startsWith('min') ? 'minute' : u.startsWith('h') ? 'hour' : 'day'}${n === 1 ? '' : 's'}` }; }
  if (/last hour|past hour/.test(t)) return { hours: 1, label: 'in the last hour' };
  if (/today|24 ?h|last day|past day/.test(t)) return { hours: 24, label: 'in the last 24 hours' };
  if (/week|7 days/.test(t)) return { hours: 168, label: 'in the last 7 days' };
  return { label: 'since monitoring began' };
}

export async function answerWithRules(messages: Msg[], tz: string, exec: Exec = runTool): Promise<ChatReply> {
  const raw = messages[messages.length - 1].content, t = raw.toLowerCase();
  const cards = new Map<number, AlertCard>(), tool = async (n: string, a: any = {}) => { const r = await exec(n, a); collectCards(n, r, cards); return r; };
  const mm = t.match(MILL_RE), mill = mm ? `RM-0${mm[1] ?? mm[2]}` : undefined, win = parseWindow(t);
  const where = mill ? ` on ${mill}` : '';
  const line = (a: any) => `**#${a.id}** - ${KIND_SHORT[a.kind]} on ${a.mill}, ${fmtTime(a.started_at, tz)} (${ago(a.started_at)}), lasted ${dur(a.duration_seconds)}`;
  const done = (reply: string, followups?: string[]): ChatReply => ({ reply, alerts: [...cards.values()], followups: followups ?? followupsFor(cards), mode: 'rules' });
  const idMatch = t.match(/(?:alert\s*)?#\s*(\d+)|alert\s+(?:number\s+|no\.?\s*)?(\d+)/);
  const lastRef = [...messages].reverse().slice(1).map((m) => m.content.match(/#(\d+)/)?.[1]).find(Boolean);

  // 1) a specific alert, or "explain this/it" after an answer that mentioned one
  const explain = /explain|why|what happened|what caused|details?|tell me more|simple terms/.test(t);
  const wantId = idMatch ? +(idMatch[1] ?? idMatch[2]) : explain && /\b(this|it|that)\b/.test(t) && lastRef ? +lastRef : null;
  if (wantId) {
    const a = await tool('get_alert_details', { id: wantId });
    if (a.error) return done(`I could not find alert #${wantId}. Try "show the latest alerts".`);
    const changes = (a.what_changed as any[]).map((c) => `- ${c.signal}: normally about ${c.normal}, reached ${c.at_worst} (${c.change_percent >= 0 ? '+' : ''}${c.change_percent}%)`).join('\n');
    const early = a.early_warning_lead_seconds ? `\n\nThe system had warned about this **${a.early_warning_lead_seconds} seconds earlier** (alert #${a.early_warning_alert_id}).` : a.kind === 'cobble_signature' ? '\n\nNo early warning came before this one.' : '';
    return done(`**Alert #${a.id}: ${a.kind_plain}** on ${a.mill}\nIt started at ${fmtTime(a.started_at, tz)} (${ago(a.started_at)}) and lasted ${dur(a.duration_seconds)}. Seriousness: **${sevPlain(a.severity)}**.\n\n${a.why}${changes ? `\n\nWhat changed:\n${changes}` : ''}${early}`);
  }
  // 2) early warning / notice before a cobble
  if (/early warning|precursor|notice|lead time|warn(ed|ing)? (us|before)|before (a|the) (cobble|jam)/.test(t)) {
    const r = await tool('list_alerts', { kind: 'cobble_signature', mill, hours: win.hours, limit: 10 }), list = r.alerts as any[];
    if (!list.length) return done(`No cobbles have been recorded ${win.label}${where}, so there was nothing to warn about.`);
    const warned = list.filter((a) => a.early_warning_lead_seconds);
    const leads = warned.map((a) => a.early_warning_lead_seconds as number);
    return done(`${list.length} cobble${list.length > 1 ? 's' : ''} recorded ${win.label}${where}; **${warned.length}** had an early warning first.` +
      (leads.length ? ` Notice ranged from ${Math.min(...leads)} to ${Math.max(...leads)} seconds - time enough for an operator to check the stand.` : ' None had advance notice, so those jams were sudden.'));
  }
  // 3) right now
  if (/right now|currently|at the moment|status|running ok|is (everything|it|the mill) (ok|fine|normal)|how('s| is) (it|the mill|rm)/.test(t)) {
    const ms = mill ? [mill] : ['RM-01', 'RM-02'], out: string[] = [];
    for (const m of ms) {
      const s = await tool('get_current_status', { mill: m });
      out.push(s.status === 'no data yet' ? `**${m}**: no data yet.` : `**${m}**: ${s.status === 'normal' ? 'running normally' : s.status}${s.data_is_stale ? ' (readings look stale - the data feed may be paused)' : ''}. Motor speed ${s.latest_values['motor speed']} rpm, vibration ${s.latest_values['machine vibration']} mm/s.`);
    }
    return done(out.join('\n'), ['What was the latest alert and why did it happen?', 'How many alerts have we had?']);
  }
  // 4) sensor history
  const sig = SIGNAL_WORDS.find(([re]) => re.test(t))?.[1];
  if (sig && /average|typical|normal|highest|lowest|max|min|how (high|low)|stats|compare|history|trend|level/.test(t)) {
    const minutes = win.hours ? Math.round(win.hours * 60) : 15, m = mill ?? 'RM-01';
    const s = await tool('get_signal_stats', { mill: m, signal: sig, minutes });
    if (!s.normal_periods && !s.during_alerts) return done(`I have no ${SIGNAL_PLAIN[sig]} readings for ${m} in the last ${minutes} minutes.`);
    const n = s.normal_periods, d = s.during_alerts;
    return done(`**${m} - ${SIGNAL_PLAIN[sig]}, last ${minutes} minutes**\n${n ? `- Normal running: average ${n.average}, between ${n.lowest} and ${n.highest}\n` : ''}${d ? `- During alerts: average ${d.average}, peaking at ${d.highest}${n ? ` (${d.highest / n.average >= 2 ? `about ${Math.round(d.highest / n.average)} times` : `${Math.round(((d.highest - n.average) / n.average) * 100)}% above`} the normal average)` : ''}` : '- No alert happened in this period.'}`,
      ['What was the latest alert and why did it happen?', 'Did we get any early warning before a cobble?']);
  }
  // 5) counts / which mill
  if (/how many|count|total|number of|which mill|compare|more alerts|busiest|any alerts|were there/.test(t)) {
    const s = await tool('get_alert_summary', { mill, hours: win.hours });
    if (!s.total_alerts) return done(`No alerts have been recorded ${win.label}${where}. Everything has been quiet.`);
    const types = Object.entries(s.by_type).map(([k, n]) => `${n} x ${k.split(' (')[0].toLowerCase()}`).join(', '), mills = Object.entries(s.by_mill).map(([k, n]) => `${k}: ${n}`).join(', ');
    const bm = Object.entries(s.by_mill) as [string, number][], top = [...bm].sort((a, b) => b[1] - a[1]);
    const who = mill || bm.length < 2 ? '' : top[0][1] === top[1][1] ? ' Both mills had the same number.' : ` **${top[0][0]}** had more.`;
    return done(`**${s.total_alerts} alert${s.total_alerts > 1 ? 's' : ''}** ${win.label}${where} - ${types}.\nBy mill: ${mills}.${who}\nSerious: ${s.by_severity.critical ?? 0}, warnings: ${s.by_severity.warning ?? 0}.`);
  }
  // 6) serious / cobbles
  if (/serious|critical|worst|strongest|biggest|cobble|jam/.test(t) && !/latest|last|recent/.test(t)) {
    const r = await tool('list_alerts', { severity: 'critical', mill, hours: win.hours, order: 'strongest', limit: 5 });
    if (!r.count) return done(`No serious alerts ${win.label}${where}.`);
    return done(`The ${r.count} most serious alert${r.count > 1 ? 's' : ''} ${win.label}${where}:\n${(r.alerts as any[]).map((a) => `- ${line(a)}`).join('\n')}`);
  }
  // 7) latest / recent (also the default for "alert"-ish questions)
  if (/latest|last|recent|newest|most recent|alert|happen/.test(t)) {
    const r = await tool('list_alerts', { mill, hours: win.hours, limit: /alerts|recent|show/.test(t) && !/latest|last alert|most recent/.test(t) ? 5 : 1 });
    if (!r.count) return done(`No alerts have been recorded ${win.label}${where}.`);
    const top = r.alerts[0];
    return r.count === 1
      ? done(`The latest alert is **#${top.id}** on ${top.mill}: a ${top.kind_plain.toLowerCase()}. It started ${fmtTime(top.started_at, tz)} (${ago(top.started_at)}) and lasted ${dur(top.duration_seconds)}.\n\n${top.why}${top.early_warning_lead_seconds ? `\n\nThe system warned about it ${top.early_warning_lead_seconds} seconds in advance.` : ''}`)
      : done(`The ${r.count} most recent alerts:\n${(r.alerts as any[]).map((a) => `- ${line(a)}`).join('\n')}`);
  }
  return done('I can answer questions about this plant\'s alerts and sensor history - for example the latest alert and why it happened, how many alerts there have been, whether we got an early warning before a cobble, or how vibration has been running. What would you like to know?', SUGGESTIONS);
}

/** Entry point: LLM when a key is configured (falls back to rules on any LLM failure), rules otherwise. */
export async function answer(messages: Msg[], tzIn?: string): Promise<ChatReply> {
  const tz = safeTz(tzIn);
  if (llmEnabled()) {
    try { return await answerWithLLM(messages, tz); }
    catch (e) { console.error('[chat] LLM failed, using rules:', (e as Error).message); const r = await answerWithRules(messages, tz); return { ...r, note: 'The AI service was unavailable, so this is a basic answer.' }; }
  }
  return answerWithRules(messages, tz);
}
