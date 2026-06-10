import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const now = sql`(unixepoch())`;

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull().unique(),
  name: text('name').notNull(),
  archetype: text('archetype'), // agency | fintech | support_automation | devtool | regulated | platform_team | ...
  icpScore: integer('icp_score'),
  scoreRationale: text('score_rationale'),
  headcount: integer('headcount'),
  funding: text('funding'),
  sourcesJson: text('sources_json'), // [{type: 'job_post'|'github'|'hn'|'blog', url, snippet}]
  status: text('status').notNull().default('new'), // new | qualified | rejected
  createdAt: integer('created_at').notNull().default(now),
});

export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull().references(() => accounts.id),
    name: text('name').notNull(),
    title: text('title'),
    email: text('email'),
    emailStatus: text('email_status').notNull().default('none'), // none | unverified | verified | dropped
    emailSource: text('email_source'), // commit | pattern | manual
    github: text('github'),
    linkedin: text('linkedin'),
    region: text('region'), // used by the EU commit-path guardrail
    signalUrl: text('signal_url'),
    signalSummary: text('signal_summary'),
    status: text('status').notNull().default('new'), // new | queued | in_sequence | replied | activated | suppressed
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('contacts_status_idx').on(t.status), index('contacts_email_idx').on(t.email)],
);

export const sequences = sqliteTable('sequences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contactId: integer('contact_id').notNull().references(() => contacts.id),
  variant: text('variant').notNull(), // A | B | C (archetype-mapped)
  step: integer('step').notNull().default(0), // 0 = not started, 1..3 sent
  nextSendAt: integer('next_send_at'),
  stoppedReason: text('stopped_reason'), // replied | unsubscribed | bounced | completed | manual
  createdAt: integer('created_at').notNull().default(now),
});

export const sends = sqliteTable('sends', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contactId: integer('contact_id').notNull().references(() => contacts.id),
  step: integer('step').notNull(),
  inboxId: integer('inbox_id').notNull(),
  gmailMessageId: text('gmail_message_id'),
  subject: text('subject'),
  body: text('body'),
  approvedBy: text('approved_by'), // review-gate audit: human | sampling
  sentAt: integer('sent_at'),
  bouncedAt: integer('bounced_at'),
});

export const replies = sqliteTable('replies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contactId: integer('contact_id').references(() => contacts.id),
  threadId: text('thread_id'),
  classification: text('classification'), // positive | question | objection | ooo | unsubscribe | bounce
  snippet: text('snippet'),
  suggestedDraft: text('suggested_draft'),
  receivedAt: integer('received_at').notNull().default(now),
  handled: integer('handled', { mode: 'boolean' }).notNull().default(false),
});

export const suppression = sqliteTable('suppression', {
  email: text('email').primaryKey(),
  reason: text('reason').notNull(), // unsubscribe | hard_bounce | said_no | manual
  addedAt: integer('added_at').notNull().default(now),
});

export const inboxes = sqliteTable('inboxes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  domain: text('domain').notNull(),
  composioConnectionId: text('composio_connection_id'),
  rampStartedAt: integer('ramp_started_at'),
  dailyCap: integer('daily_cap').notNull().default(10), // recomputed daily from ramp schedule
  sentToday: integer('sent_today').notNull().default(0),
  bounceCount: integer('bounce_count').notNull().default(0),
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  pausedReason: text('paused_reason'),
});

export const intentFeed = sqliteTable('intent_feed', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(), // reddit | hn | x | github
  url: text('url').notNull().unique(),
  author: text('author'),
  snippet: text('snippet'),
  relevanceScore: integer('relevance_score'),
  postedAt: integer('posted_at'),
  handled: integer('handled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

export const communityInteractions = sqliteTable('community_interactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  person: text('person').notNull(),
  community: text('community').notNull(),
  url: text('url'),
  type: text('type').notNull(), // give | reply | dm | post
  notes: text('notes'),
  at: integer('at').notNull().default(now),
});

export const metricsDaily = sqliteTable('metrics_daily', {
  date: text('date').primaryKey(), // YYYY-MM-DD
  signups: integer('signups'),
  activated: integer('activated'),
  activatedCumulative: integer('activated_cumulative'),
  invitesSent: integer('invites_sent'),
  invitesAccepted: integer('invites_accepted'),
  kFactor: real('k_factor'),
  emailsDelivered: integer('emails_delivered'),
  emailReplies: integer('email_replies'),
  channelAttributionJson: text('channel_attribution_json'),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agent: text('agent').notNull(),
    action: text('action').notNull(),
    payloadJson: text('payload_json'),
    at: integer('at').notNull().default(now),
  },
  (t) => [index('audit_agent_idx').on(t.agent, t.at)],
);
