import { sql, eq, gte, and } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { config } from '../../core/config.js';
import { getCampaignStart, isDryRun } from '../../core/go-live.js';
import { fetchPostHogDailyMetrics } from '../../core/posthog-metrics.js';
import type { ScorecardRow } from '../../core/sheets.js';

const DAY = 86_400_000;
const POSTHOG_DASHBOARD = 'https://us.posthog.com/project/464332/dashboard/1694728';

export type DailyScorecard = {
  row: ScorecardRow;
  paceLine: string;
  activationLine: string;
  alarms: string[];
  digestExtras: string[];
};

function expectedToday(day: number): number {
  const points = [[0, 0], ...Object.entries(config.paceLine).map(([d, t]) => [Number(d), t] as [number, number])];
  for (let i = 1; i < points.length; i++) {
    const [d0, t0] = points[i - 1];
    const [d1, t1] = points[i];
    if (day <= d1) return Math.round(t0 + ((day - d0) / (d1 - d0)) * (t1 - t0));
  }
  return points[points.length - 1][1];
}

async function campaignDayNumber(): Promise<number | null> {
  const start = await getCampaignStart();
  if (!start) return null;
  const diff = Date.now() - new Date(`${start}T00:00:00`).getTime();
  return diff < 0 ? null : Math.floor(diff / DAY) + 1;
}

function midnightMs(d = new Date()): number {
  return new Date(d.toISOString().slice(0, 10)).getTime();
}

export async function collectDailyScorecard(date = new Date()): Promise<DailyScorecard> {
  const dateStr = date.toISOString().slice(0, 10);
  const dayStart = midnightMs(date);

  const [acc] = await db.select({ n: sql<number>`count(*)`, hi: sql<number>`sum(case when icp_score >= 70 then 1 else 0 end)` }).from(schema.accounts);
  const [con] = await db
    .select({
      n: sql<number>`count(*)`,
      verified: sql<number>`sum(case when email_status = 'verified' then 1 else 0 end)`,
      inSeq: sql<number>`sum(case when status = 'in_sequence' then 1 else 0 end)`,
      replied: sql<number>`sum(case when status = 'replied' then 1 else 0 end)`,
    })
    .from(schema.contacts);
  const [snd] = await db.select({ n: sql<number>`count(*)`, bounced: sql<number>`sum(case when bounced_at is not null then 1 else 0 end)` }).from(schema.sends);
  const [sndToday] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.sends)
    .where(gte(schema.sends.sentAt, dayStart));

  const replies = await db
    .select({ classification: schema.replies.classification, n: sql<number>`count(*)` })
    .from(schema.replies)
    .groupBy(schema.replies.classification);

  const [signalsToday] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.intentFeed)
    .where(gte(schema.intentFeed.createdAt, Math.floor(dayStart / 1000)));

  const replyCount = (label: string) => replies.find((r) => r.classification === label)?.n ?? 0;

  const posthog = await fetchPostHogDailyMetrics(date).catch(() => null);
  const campaignDay = await campaignDayNumber();
  const activatedTotal = posthog?.activatedTotal ?? 0;
  const paceTarget = campaignDay !== null ? expectedToday(campaignDay) : '';
  const onPace = campaignDay !== null && posthog ? (activatedTotal >= expectedToday(campaignDay) ? 'YES' : 'NO') : '';

  let paceLine = '_Campaign not started — auto go-live will set CAMPAIGN_START when warmup completes_';
  if (campaignDay !== null && posthog) {
    const targets = Object.entries(config.paceLine).map(([d, t]) => [Number(d), t] as const);
    const nextTarget = targets.find(([d]) => d >= campaignDay) ?? targets[targets.length - 1];
    paceLine = `Day ${campaignDay}/20 — next milestone D${nextTarget[0]}=${nextTarget[1]} — ${onPace === 'YES' ? '✅ on pace' : '⚠️ BEHIND PACE'}`;
  }

  let activationLine = '_PostHog not configured — product funnel unavailable_';
  if (posthog) {
    activationLine = `Activated workspaces: *${posthog.activatedTotal}* (+${posthog.activatedToday} today) · Signups: ${posthog.signupsCumulative} (+${posthog.signupsToday} today)`;
  }

  const alarms: string[] = [];
  const inboxes = await db.query.inboxes.findMany();
  for (const inbox of inboxes) {
    const [s] = await db
      .select({ n: sql<number>`count(*)`, bounced: sql<number>`sum(case when bounced_at is not null then 1 else 0 end)` })
      .from(schema.sends)
      .where(eq(schema.sends.inboxId, inbox.id));
    if ((s.n ?? 0) >= 20 && (s.bounced ?? 0) / s.n > config.outreach.maxBounceRate && !inbox.paused) {
      await db.update(schema.inboxes).set({ paused: true, pausedReason: `auto: bounce rate ${((s.bounced / s.n) * 100).toFixed(1)}%` }).where(eq(schema.inboxes.id, inbox.id));
      alarms.push(`🚨 AUTO-PAUSED ${inbox.email} — bounce rate ${((s.bounced / s.n) * 100).toFixed(1)}%`);
    }
  }

  const row: ScorecardRow = {
    date: dateStr,
    campaign_day: campaignDay ?? '',
    engine_mode: (await isDryRun()) ? 'DRY_RUN' : 'LIVE',
    on_pace: onPace,
    pace_target: paceTarget,
    signups_today: posthog?.signupsToday ?? '',
    signups_cumulative: posthog?.signupsCumulative ?? '',
    activated_today: posthog?.activatedToday ?? '',
    activated_total: posthog?.activatedTotal ?? '',
    invites_sent_today: posthog?.invitesSentToday ?? '',
    invites_accepted_today: posthog?.invitesAcceptedToday ?? '',
    accounts_total: acc.n ?? 0,
    accounts_qualified: acc.hi ?? 0,
    contacts_total: con.n ?? 0,
    contacts_verified: con.verified ?? 0,
    contacts_in_sequence: con.inSeq ?? 0,
    contacts_replied: con.replied ?? 0,
    emails_sent_today: sndToday.n ?? 0,
    emails_sent_total: snd.n ?? 0,
    emails_bounced: snd.bounced ?? 0,
    replies_positive: replyCount('positive'),
    replies_question: replyCount('question'),
    replies_objection: replyCount('objection'),
    replies_ooo: replyCount('ooo'),
    replies_unsubscribe: replyCount('unsubscribe'),
    intent_signals_today: signalsToday.n ?? 0,
    posthog_dashboard: POSTHOG_DASHBOARD,
  };

  await db
    .insert(schema.metricsDaily)
    .values({
      date: dateStr,
      signups: posthog?.signupsToday ?? null,
      activated: posthog?.activatedToday ?? null,
      activatedCumulative: posthog?.activatedTotal ?? null,
      invitesSent: posthog?.invitesSentToday ?? null,
      invitesAccepted: posthog?.invitesAcceptedToday ?? null,
      emailsDelivered: sndToday.n ?? null,
      emailReplies: replies.reduce((sum, r) => sum + (r.n ?? 0), 0),
    })
    .onConflictDoUpdate({
      target: schema.metricsDaily.date,
      set: {
        signups: posthog?.signupsToday ?? null,
        activated: posthog?.activatedToday ?? null,
        activatedCumulative: posthog?.activatedTotal ?? null,
        invitesSent: posthog?.invitesSentToday ?? null,
        invitesAccepted: posthog?.invitesAcceptedToday ?? null,
        emailsDelivered: sndToday.n ?? null,
        emailReplies: replies.reduce((sum, r) => sum + (r.n ?? 0), 0),
      },
    });

  return {
    row,
    paceLine,
    activationLine,
    alarms,
    digestExtras: [],
  };
}
