import { z } from 'zod';
import { eq, isNull, and } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { getAgentMail } from '../../core/agentmail.js';
import { discordPost } from '../../core/discord.js';
import { completeJson } from '../../core/llm.js';

const classificationSchema = z.object({
  classification: z.enum(['positive', 'question', 'objection', 'ooo', 'unsubscribe', 'bounce', 'other']),
  summary: z.string().describe('one line: what they said'),
  suggestedDraft: z
    .string()
    .describe('founder-voice reply draft: direct, helpful, no marketing language. For positive: offer the 15-min concierge setup with a Cal link placeholder {{CAL_LINK}}. For unsubscribe/bounce: empty string.'),
});

/**
 * Reply Triager — every 5 min. Playbook §9.4 B3.
 * Polls unread messages on every AgentMail inbox -> classifies -> stops sequence +
 * suppresses where applicable -> Discord #gtm-replies with a suggested draft.
 * NEVER auto-sends. Processed messages are marked read so they aren't re-triaged.
 */
export async function runReplyTriager() {
  const agentmail = getAgentMail();
  if (!agentmail) {
    await audit('reply-triager', 'run.skipped', { reason: 'no AGENTMAIL_API_KEY' });
    return;
  }

  const inboxes = await db.query.inboxes.findMany();
  if (inboxes.length === 0) return; // nothing to poll until inboxes are registered

  await audit('reply-triager', 'run.start');
  let processed = 0;

  // Warmup traffic (our own inboxes + seed addresses) is the warmup agent's
  // territory — skip WITHOUT marking read so it can reply and mark read itself.
  const internalSenders = new Set([
    ...inboxes.map((i) => i.email.toLowerCase()),
    ...config.warmup.seedEmails.map((s) => s.toLowerCase()),
  ]);

  for (const inbox of inboxes) {
    let messages;
    try {
      const result = await agentmail.inboxes.messages.list(inbox.email, { limit: 20, labels: ['unread'] });
      messages = result.messages ?? [];
    } catch (err) {
      await audit('reply-triager', 'fetch.failed', { inbox: inbox.email, error: String(err) });
      continue;
    }

    for (const item of messages) {
      const fromEmail = extractEmail(item.from ?? '');
      if (!fromEmail) continue;
      if (internalSenders.has(fromEmail)) continue; // warmup thread — not a prospect reply

      // The list endpoint returns previews — fetch the full message for the body.
      // extractedText is the reply minus quoted history, exactly what the classifier needs.
      const msg = await agentmail.inboxes.messages.get(inbox.email, item.messageId).catch(() => null);
      const body = (msg?.extractedText ?? msg?.text ?? item.preview ?? '').slice(0, 3000);

      // Mark read first so a crash mid-classification can't cause a re-triage loop.
      await agentmail.inboxes.messages
        .update(inbox.email, item.messageId, { addLabels: ['read'], removeLabels: ['unread'] })
        .catch(() => {});

      if (!body.trim()) continue;

      const contact = await db.query.contacts.findFirst({ where: eq(schema.contacts.email, fromEmail) });

      const out = await completeJson(
        'You triage replies to cold outreach for observal.io (a system of record for AI agents). Classify and draft.',
        `Reply from ${item.from}:\n\n${body}`,
        classificationSchema,
        { qa: false },
      );

      await db.insert(schema.replies).values({
        contactId: contact?.id ?? null,
        threadId: item.threadId ?? null,
        classification: out.classification,
        snippet: out.summary,
        suggestedDraft: out.suggestedDraft || null,
      });

      if (contact) {
        // Stop the sequence on ANY reply — stop-on-reply is absolute.
        await db
          .update(schema.sequences)
          .set({ stoppedReason: 'replied' })
          .where(and(eq(schema.sequences.contactId, contact.id), isNull(schema.sequences.stoppedReason)));
        await db.update(schema.contacts).set({ status: 'replied' }).where(eq(schema.contacts.id, contact.id));

        if (out.classification === 'unsubscribe' || out.classification === 'bounce' || out.classification === 'objection') {
          await db
            .insert(schema.suppression)
            .values({ email: fromEmail, reason: out.classification === 'objection' ? 'said_no' : out.classification })
            .onConflictDoNothing();
        }
      }

      await discordPost(
        config.discord.replies,
        `*${out.classification.toUpperCase()}* from ${item.from} (inbox: ${inbox.email})\n> ${out.summary}\n\n*Suggested draft:*\n${out.suggestedDraft || '_none_'}\n\n_Reply manually from ${inbox.email} — the triager never sends._`,
      ).catch(() => {});

      processed++;
    }
  }

  await audit('reply-triager', 'run.end', { processed });
}

function extractEmail(sender: string): string | null {
  const m = sender.match(/<([^>]+)>/) ?? sender.match(/([^\s]+@[^\s]+)/);
  return m ? m[1].toLowerCase() : null;
}
