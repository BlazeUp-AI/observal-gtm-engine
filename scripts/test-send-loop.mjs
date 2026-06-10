// Self-test: send from one of our AgentMail inboxes to another, then poll for arrival.
// Validates the live send path + inbound delivery without touching any real prospect.
import 'dotenv/config';
import { getAgentMail } from '../src/core/agentmail.ts';

const am = getAgentMail();
if (!am) throw new Error('AGENTMAIL_API_KEY missing');

const FROM = 'aryan@useobserval.xyz';
const TO = 'aryan@tryobserval.xyz';

const sent = await am.inboxes.messages.send(FROM, {
  to: TO,
  subject: 'gtm-engine loop test',
  text: 'If you can read this, the send path and inbound delivery both work.',
  headers: { 'List-Unsubscribe': '<https://observal.io/unsub>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
});
console.log(`sent: ${sent.messageId}`);

for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const res = await am.inboxes.messages.list(TO, { limit: 5 });
  const hit = (res.messages ?? []).find((m) => m.subject === 'gtm-engine loop test');
  if (hit) {
    console.log(`received in ${TO}: messageId=${hit.messageId} labels=${JSON.stringify(hit.labels)}`);
    process.exit(0);
  }
}
console.log('not received within 30s — check the AgentMail console');
process.exit(1);
