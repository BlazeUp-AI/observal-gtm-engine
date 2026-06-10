import { z } from 'zod';
import { eq, isNull, and } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { getComposio, ENTITY, slackPost } from '../../core/composio.js';
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
 * Polls unread threads on every inbox -> classifies -> stops sequence + suppresses
 * where applicable -> Slack #replies with a suggested draft. NEVER auto-sends.
 */
export async function runReplyTriager() {
  const composio = getComposio();
  if (!composio) {
    await audit('reply-triager', 'run.skipped', { reason: 'no COMPOSIO_API_KEY' });
    return;
  }

  const inboxes = await db.query.inboxes.findMany();
  if (inboxes.length === 0) return; // nothing to poll until inboxes are registered

  await audit('reply-triager', 'run.start');
  let processed = 0;

  for (const inbox of inboxes) {
    let messages: GmailMessage[] = [];
    try {
      const result = await composio.tools.execute('GMAIL_FETCH_EMAILS', {
        userId: ENTITY.inbox(inbox.email),
        arguments: { query: 'is:unread -category:promotions', max_results: 20 },
      });
      messages = ((result.data as { messages?: GmailMessage[] })?.messages ?? []);
    } catch (err) {
      await audit('reply-triager', 'fetch.failed', { inbox: inbox.email, error: String(err) });
      continue;
    }

    for (const msg of messages) {
      const fromEmail = extractEmail(msg.sender ?? '');
      if (!fromEmail) continue;

      const contact = await db.query.contacts.findFirst({ where: eq(schema.contacts.email, fromEmail) });
      const body = (msg.messageText ?? msg.preview?.body ?? '').slice(0, 3000);
      if (!body.trim()) continue;

      const out = await completeJson(
        'You triage replies to cold outreach for observal.io (a system of record for AI agents). Classify and draft.',
        `Reply from ${msg.sender}:\n\n${body}`,
        classificationSchema,
        { qa: false },
      );

      await db.insert(schema.replies).values({
        contactId: contact?.id ?? null,
        threadId: msg.threadId ?? null,
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

      await slackPost(
        config.slack.replies,
        `*${out.classification.toUpperCase()}* from ${msg.sender} (inbox: ${inbox.email})\n> ${out.summary}\n\n*Suggested draft:*\n${out.suggestedDraft || '_none_'}\n\n_Reply manually from ${inbox.email} — the triager never sends._`,
      ).catch(() => {});

      processed++;
    }
  }

  await audit('reply-triager', 'run.end', { processed });
}

interface GmailMessage {
  threadId?: string;
  sender?: string;
  messageText?: string;
  preview?: { body?: string };
}

function extractEmail(sender: string): string | null {
  const m = sender.match(/<([^>]+)>/) ?? sender.match(/([^\s]+@[^\s]+)/);
  return m ? m[1].toLowerCase() : null;
}
