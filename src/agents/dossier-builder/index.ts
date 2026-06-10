import { z } from 'zod';
import { eq, like } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { discordPost } from '../../core/discord.js';
import { completeJson } from '../../core/llm.js';
import { appendOutcomeRow, defaultOutcomeMeta } from '../../core/sheets.js';

const CAL_LINK = process.env.CAL_LINK ?? 'https://cal.com/observal/concierge';

const dossierSchema = z.object({
  who: z.string().describe('one line: name, likely role, company'),
  archetype: z.string(),
  likelyAgents: z.string().describe('best guess at what agents this team runs, from the evidence'),
  onboardingAngle: z.string().describe('one specific suggestion for the concierge call opener'),
});

/**
 * Dossier Builder — fires on product signup (server.ts /webhooks/signup).
 * Matches the signup against the prospect DB, compiles a 5-line dossier with
 * Gemini, posts to Slack #new-signups within minutes — speed-to-concierge is
 * the activation lever (playbook §9.6 D1).
 */
export async function buildDossier(signup: { email: string; name?: string; company?: string }) {
  await audit('dossier-builder', 'signup.received', { email: signup.email });

  const domain = signup.email.split('@')[1]?.toLowerCase() ?? '';
  const knownContact = await db.query.contacts.findFirst({ where: eq(schema.contacts.email, signup.email.toLowerCase()) });
  const knownAccount =
    (knownContact ? await db.query.accounts.findFirst({ where: eq(schema.accounts.id, knownContact.accountId) }) : null) ??
    (await db.query.accounts.findFirst({ where: like(schema.accounts.domain, `%${domain}%`) }));

  const context = [
    `Signup: ${signup.name ?? '?'} <${signup.email}>${signup.company ? ` at ${signup.company}` : ''}`,
    knownAccount
      ? `KNOWN account: ${knownAccount.name} (${knownAccount.domain}) — archetype ${knownAccount.archetype}, ICP ${knownAccount.icpScore}. Rationale: ${knownAccount.scoreRationale}`
      : `Unknown account — domain ${domain}.`,
    knownContact ? `KNOWN contact signal: ${knownContact.signalSummary} (${knownContact.signalUrl})` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let lines: string;
  try {
    const d = await completeJson(
      'You prep a founder for a 15-minute concierge onboarding call with a new signup of observal.io (system of record for AI agents). Be specific, no fluff.',
      context,
      dossierSchema,
    );
    lines = `*Who:* ${d.who}\n*Archetype:* ${d.archetype}\n*Likely agents:* ${d.likelyAgents}\n*Angle:* ${d.onboardingAngle}`;
  } catch {
    lines = `*Who:* ${signup.name ?? signup.email}\n*Context:* ${knownAccount ? `${knownAccount.name} — ICP ${knownAccount.icpScore}` : 'cold signup, no prospect match'}`;
  }

  const sourceTag = knownContact ? '🎯 outreach-sourced' : knownAccount ? '📋 known account' : '🆕 organic';
  await discordPost(
    config.discord.newSignups,
    `*New signup* ${sourceTag}\n${lines}\n\n→ Offer concierge within the hour: ${CAL_LINK}`,
  ).catch(() => {});

  if (knownContact) {
    await db.update(schema.contacts).set({ status: 'activated' }).where(eq(schema.contacts.id, knownContact.id));
  }
  await audit('dossier-builder', 'dossier.posted', { email: signup.email, matched: Boolean(knownAccount) });

  const meta = await defaultOutcomeMeta();
  void appendOutcomeRow({
    ...meta,
    timestamp: new Date().toISOString(),
    outcome_type: 'signup',
    summary: `${signup.name ?? signup.email}${knownAccount ? ` · ${knownAccount.name}` : ''}`,
    entity: signup.email,
    company: signup.company ?? knownAccount?.name ?? '',
    channel: knownContact ? 'email' : knownAccount ? 'known_account' : 'organic',
    url: knownContact?.signalUrl ?? '',
    source: knownContact ? 'outreach' : knownAccount ? 'known_account' : 'organic',
  }).catch(() => {});
}
