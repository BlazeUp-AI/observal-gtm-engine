import { and, eq, gte } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { maybeAutoGoLive } from '../../core/go-live.js';
import { getAgentMail } from '../../core/agentmail.js';
import { complete } from '../../core/llm.js';

const DAY = 86_400_000;

/**
 * Warmup agent — every 2h inside the send window. Playbook §9.4 deliverability.
 *
 * Builds sender reputation by exchanging human-looking email between OUR OWN
 * inboxes (+ optional seed addresses): new threads, replies, and read-marking.
 * This is the engagement signal mailbox providers look for before trusting a
 * new domain with volume.
 *
 * IMPORTANT: runs live even under DRY_RUN — it is safe by construction because
 * recipients are strictly the engine's own registered inboxes and the
 * WARMUP_SEED_EMAILS allowlist. No prospect address can ever enter this path.
 */
export async function runWarmup() {
  const agentmail = getAgentMail();
  if (!agentmail) {
    await audit('warmup', 'run.skipped', { reason: 'no AGENTMAIL_API_KEY' });
    return;
  }

  const inboxes = await db.query.inboxes.findMany({ where: eq(schema.inboxes.paused, false) });
  const peers = [...inboxes.map((i) => i.email), ...config.warmup.seedEmails];
  if (inboxes.length === 0 || peers.length < 2) {
    await audit('warmup', 'run.skipped', { reason: 'need at least 2 warmup peers' });
    return;
  }

  await audit('warmup', 'run.start', { inboxes: inboxes.length, peers: peers.length });
  let sent = 0;
  let replied = 0;

  const ownEmails = new Set(inboxes.map((i) => i.email.toLowerCase()));

  for (const inbox of inboxes) {
    // --- Pass 1: handle incoming warmup mail (reply sometimes, then mark read) ---
    try {
      const unread = await agentmail.inboxes.messages.list(inbox.email, { limit: 10, labels: ['unread'] });
      for (const item of unread.messages ?? []) {
        const fromEmail = extractEmail(item.from ?? '');
        if (!fromEmail || !isWarmupPeer(fromEmail, ownEmails)) continue; // triager's territory

        if (Math.random() < config.warmup.replyProbability && !(await alreadyReplied(inbox.email, item.threadId))) {
          const replyText = await warmupReplyText(item.subject ?? '');
          await agentmail.inboxes.messages.reply(inbox.email, item.messageId, { text: replyText });
          await db.insert(schema.warmupSends).values({
            inboxEmail: inbox.email,
            toEmail: fromEmail,
            threadId: item.threadId ?? null,
            subject: item.subject ?? null,
            isReply: true,
          });
          replied++;
        }
        await agentmail.inboxes.messages
          .update(inbox.email, item.messageId, { addLabels: ['read'], removeLabels: ['unread'] })
          .catch(() => {});
      }
    } catch (err) {
      await audit('warmup', 'inbound.failed', { inbox: inbox.email, error: String(err) });
    }

    // --- Pass 2: start new threads if under today's warmup target ---
    const rampDay = inbox.rampStartedAt ? Math.floor((Date.now() - inbox.rampStartedAt) / DAY) + 1 : 1;
    const target = config.warmup.targetForDay(rampDay);
    const sentToday = await warmupSentToday(inbox.email);
    const remaining = target - sentToday;
    // Spread the day's quota across runs: at most 2 new threads per 2h cycle.
    const batch = Math.min(remaining, 2);

    for (let i = 0; i < batch; i++) {
      const to = pickPeer(peers, inbox.email);
      if (!to) break;
      try {
        const { subject, body } = await warmupThread();
        const res = await agentmail.inboxes.messages.send(inbox.email, { to, subject, text: body });
        await db.insert(schema.warmupSends).values({
          inboxEmail: inbox.email,
          toEmail: to,
          threadId: res.threadId ?? null,
          subject,
          isReply: false,
        });
        sent++;
        // Human-ish jitter between warmup sends (20-90s).
        await new Promise((r) => setTimeout(r, 20_000 + Math.random() * 70_000));
      } catch (err) {
        await audit('warmup', 'send.failed', { inbox: inbox.email, to, error: String(err) });
      }
    }
  }

  await audit('warmup', 'run.end', { sent, replied });
  await maybeAutoGoLive();
}

/** A sender counts as a warmup peer if it's one of our inboxes or a seed address. */
function isWarmupPeer(email: string, ownEmails: Set<string>): boolean {
  const e = email.toLowerCase();
  return ownEmails.has(e) || config.warmup.seedEmails.some((s) => s.toLowerCase() === e);
}

async function alreadyReplied(inboxEmail: string, threadId?: string): Promise<boolean> {
  if (!threadId) return false;
  const existing = await db.query.warmupSends.findFirst({
    where: and(
      eq(schema.warmupSends.inboxEmail, inboxEmail),
      eq(schema.warmupSends.threadId, threadId),
      eq(schema.warmupSends.isReply, true),
    ),
  });
  return !!existing;
}

async function warmupSentToday(inboxEmail: string): Promise<number> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: schema.warmupSends.id })
    .from(schema.warmupSends)
    .where(and(eq(schema.warmupSends.inboxEmail, inboxEmail), gte(schema.warmupSends.sentAt, midnight.getTime())));
  return rows.length;
}

function pickPeer(peers: string[], self: string): string | null {
  const others = peers.filter((p) => p.toLowerCase() !== self.toLowerCase());
  if (others.length === 0) return null;
  return others[Math.floor(Math.random() * others.length)];
}

const THREAD_TOPICS = [
  'a quick question about scheduling a sync next week',
  'sharing an interesting article you read about engineering practices',
  'following up on a project status — going well, minor blockers',
  'asking for a restaurant or coffee shop recommendation',
  'coordinating notes for an upcoming team review',
  'a short observation about a conference talk or podcast episode',
  'checking in about a shared document and next steps',
  'a casual update about travel plans for a work trip',
];

async function warmupThread(): Promise<{ subject: string; body: string }> {
  const topic = THREAD_TOPICS[Math.floor(Math.random() * THREAD_TOPICS.length)];
  const raw = await complete(
    'You write short, natural, casual work emails between colleagues. Plain text. No marketing language, no sign-offs longer than a first name. 30-80 words. Return exactly: first line = subject (no "Subject:" prefix), blank line, then the body.',
    `Write an email about: ${topic}. Make it specific and human (invent plausible small details). Vary tone.`,
    { qa: true },
  );
  const [subject, ...rest] = raw.trim().split('\n');
  return { subject: subject.trim().slice(0, 80) || 'quick question', body: rest.join('\n').trim() || raw.trim() };
}

async function warmupReplyText(subject: string): Promise<string> {
  return complete(
    'You write short, natural email replies between colleagues. Plain text, 15-50 words, casual, agreeable, human. No sign-off longer than a first name.',
    `Write a brief, natural reply to a work email with subject "${subject}". Agree, add one small detail, or ask one tiny follow-up.`,
    { qa: true },
  );
}

function extractEmail(sender: string): string | null {
  const m = sender.match(/<([^>]+)>/) ?? sender.match(/([^\s]+@[^\s]+)/);
  return m ? m[1].toLowerCase() : null;
}
