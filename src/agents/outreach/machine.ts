import { and, eq, lte, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { isDryRun } from '../../core/go-live.js';
import { appendOutcomeRow, defaultOutcomeMeta } from '../../core/sheets.js';
import { variantForArchetype } from './variants.js';
import { generateOpener, fullEmailQaPasses } from './personalize.js';
import { sendEmail } from './send.js';

const SIGNUP_LINK = 'https://observal.io/signup?utm_source=outreach';
const TEMPLATE_LINK = 'https://observal.io/agent-registry-template?utm_source=outreach';
const UNSUB_BASE = 'https://observal.io/unsubscribe';

const DAY = 86_400_000;

/**
 * Sequence state machine — playbook §9.4 B2/B4.
 * Guard order before ANY send (each one audited when it blocks):
 * suppression -> inbox availability (paused/cap/ramp) -> QA -> DRY_RUN.
 */
export async function enqueueNewContacts() {
  const candidates = await db
    .select({ contact: schema.contacts, account: schema.accounts })
    .from(schema.contacts)
    .innerJoin(schema.accounts, eq(schema.contacts.accountId, schema.accounts.id))
    .where(and(eq(schema.contacts.status, 'new'), eq(schema.contacts.emailStatus, 'verified'), eq(schema.accounts.status, 'qualified')));

  for (const { contact, account } of candidates) {
    const variant = variantForArchetype(account.archetype);
    await db.insert(schema.sequences).values({ contactId: contact.id, variant: variant.id, step: 0, nextSendAt: Date.now() });
    await db.update(schema.contacts).set({ status: 'queued' }).where(eq(schema.contacts.id, contact.id));
    await audit('outreach', 'sequence.enqueued', { contactId: contact.id, variant: variant.id });
  }
  return candidates.length;
}

export async function processDueSequences(): Promise<{ sent: number; blocked: number }> {
  const due = await db
    .select({ seq: schema.sequences, contact: schema.contacts, account: schema.accounts })
    .from(schema.sequences)
    .innerJoin(schema.contacts, eq(schema.sequences.contactId, schema.contacts.id))
    .innerJoin(schema.accounts, eq(schema.contacts.accountId, schema.accounts.id))
    .where(and(isNull(schema.sequences.stoppedReason), or(lte(schema.sequences.nextSendAt, Date.now()), isNull(schema.sequences.nextSendAt))));

  let sent = 0;
  let blocked = 0;

  for (const { seq, contact, account } of due) {
    if (!contact.email) continue;

    // Guard 1: suppression — one source of truth, checked in code, every send.
    const suppressed = await db.query.suppression.findFirst({ where: eq(schema.suppression.email, contact.email) });
    if (suppressed) {
      await db.update(schema.sequences).set({ stoppedReason: 'suppressed' }).where(eq(schema.sequences.id, seq.id));
      await db.update(schema.contacts).set({ status: 'suppressed' }).where(eq(schema.contacts.id, contact.id));
      await audit('outreach', 'send.blocked.suppression', { contactId: contact.id });
      blocked++;
      continue;
    }

    // Guard 2: an inbox with headroom (unpaused, under today's ramp cap).
    const inbox = await pickInbox();
    if (!inbox) {
      blocked++;
      continue; // no inbox available — try again next cycle; do not audit-spam
    }

    // Compose the step's email.
    const variant = variantForArchetype(account.archetype);
    let subject: string;
    let body: string | null = null;

    if (seq.step === 0) {
      const opener = await generateOpener({
        name: contact.name,
        company: account.name,
        signalUrl: contact.signalUrl,
        signalSummary: contact.signalSummary,
      });
      if (!opener) {
        await db.update(schema.sequences).set({ stoppedReason: 'manual' }).where(eq(schema.sequences.id, seq.id));
        await audit('outreach', 'send.blocked.thin_signal', { contactId: contact.id, note: 'manual-review lane' });
        blocked++;
        continue;
      }
      subject = variant.subject;
      body = variant.body(opener, SIGNUP_LINK);
    } else if (seq.step === 1) {
      subject = `Re: ${variant.subject}`;
      body = variant.followUp3(SIGNUP_LINK);
    } else {
      subject = `Re: ${variant.subject}`;
      body = variant.followUp7(TEMPLATE_LINK);
    }

    // Guard 3: full-email QA (word budget + banned words).
    if (!fullEmailQaPasses(body)) {
      await audit('outreach', 'send.blocked.qa', { contactId: contact.id, step: seq.step });
      blocked++;
      continue;
    }

    // Guard 4: DRY_RUN — log the full planned send, mutate nothing.
    if (await isDryRun()) {
      await audit('outreach', 'send.dry_run', { to: contact.email, inbox: inbox.email, step: seq.step + 1, subject, words: body.split(/\s+/).length });
      blocked++;
      continue;
    }

    const messageId = await sendEmail({
      inboxEmail: inbox.email,
      to: contact.email,
      subject,
      body,
      unsubscribeUrl: `${UNSUB_BASE}?e=${encodeURIComponent(contact.email)}`,
    });
    if (!messageId) {
      blocked++;
      continue;
    }

    const nextStep = seq.step + 1;
    await db.insert(schema.sends).values({ contactId: contact.id, step: nextStep, inboxId: inbox.id, providerMessageId: messageId, subject, body, sentAt: Date.now() });
    await db
      .update(schema.sequences)
      .set({
        step: nextStep,
        nextSendAt: nextStep === 1 ? Date.now() + 3 * DAY : nextStep === 2 ? Date.now() + 4 * DAY : null,
        stoppedReason: nextStep >= 3 ? 'completed' : null,
      })
      .where(eq(schema.sequences.id, seq.id));
    await db.update(schema.contacts).set({ status: 'in_sequence' }).where(eq(schema.contacts.id, contact.id));
    await db.update(schema.inboxes).set({ sentToday: sql`${schema.inboxes.sentToday} + 1` }).where(eq(schema.inboxes.id, inbox.id));
    await audit('outreach', 'send.sent', { to: contact.email, inbox: inbox.email, step: nextStep });
    const meta = await defaultOutcomeMeta();
    void appendOutcomeRow({
      ...meta,
      timestamp: new Date().toISOString(),
      outcome_type: 'email_sent',
      summary: `Step ${nextStep}: ${subject}`,
      entity: contact.email,
      company: account.name,
      channel: 'email',
      url: '',
      source: inbox.email,
    }).catch(() => {});
    sent++;

    // Randomized human-ish gap between sends (3-9 min) — playbook §9.4.
    const gapMs = (config.outreach.minGapMinutes + Math.random() * (config.outreach.maxGapMinutes - config.outreach.minGapMinutes)) * 60_000;
    await new Promise((r) => setTimeout(r, gapMs));
  }

  return { sent, blocked };
}

async function pickInbox() {
  const all = await db.query.inboxes.findMany({ where: eq(schema.inboxes.paused, false) });
  for (const inbox of all) {
    const rampDay = inbox.rampStartedAt ? Math.floor((Date.now() - inbox.rampStartedAt) / DAY) + 1 : 1;
    if (rampDay <= config.outreach.warmupOnlyDays) continue; // warmup-only — no cold email yet
    const cap = Math.min(config.outreach.rampCapForDay(rampDay), inbox.dailyCap || Infinity);
    if (inbox.sentToday < cap) return inbox;
  }
  return null;
}
