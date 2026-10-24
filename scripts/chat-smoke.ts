import './env';
import { answerWithRules } from '../lib/chat/agent';
import { pool } from '../lib/db';
const qs = process.argv.slice(2);
(async () => {
  for (const q of qs) {
    const r = await answerWithRules([{ role: 'user', content: q }], 'Asia/Kolkata');
    console.log(`\nQ: ${q}\n${r.reply}\n  [cards: ${r.alerts.map((a) => '#' + a.id).join(', ') || '-'} | follow-ups: ${r.followups.length}]`);
  }
  await pool.end();
})();
