import { sql, eq, gte } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { config } from '../../core/config.js';
import { isDryRun, campaignDayNumber } from '../../core/go-live.js';
import { fetchPostHogDailyMetrics } from '../../core/posthog-metrics.js';
import type { ScorecardRow } from '../../core/sheets.js';
import { SHEET_URL } from '../../core/sheets.js';

const CAMPAIGN_LENGTH = 20;
const POSTHOG_DASHBOARD = 'https://us.posthog.com/project/464332/dashboard/1694728';

export type DailyScorecard = {
  row: ScorecardRow;
  paceLine: string;
  activationLine: string;
  alarms: string[];
};

function pct(n: number, d: number): string {
  if (!d) return '0.0';
  return ((n / d) * 100).toFixed(1);
}

function expectedToday(day: number): number {
  const points = [[0, 0], ...Object.entries(config.paceLine).map(([d, t]) => [Number(d), t] as [number, number])];
  for (let i = 1; i < points.length; i++) {
    const [d0, t0] = points[i - 1];
    const [d1, t1] = points[i];
    if (day <= d1) return Math.round(t0 + ((day - d0) / (d1 - d0)) * (t1 - t0));
  }
  return points[points.length - 1][1];
}

function nextMilestone(campaignDay: number): { day: number; target: number } {
  const targets = Object.entries(config.paceLine).map(([d, t]) => [Number(d), t] as const);
  const next = targets.find(([d]) => d >= campaignDay) ?? targets[targets.length - 1];
  return { day: next[0], target: next[1] };
}

function midnightMs(d = new Date()): number {
  return new Date(d.toISOString().slice(0, 10)).getTime();
}

export async function collectDailyScorecard(date = new Date()): Promise<DailyScorecard> {
  const dateStr = date.toISOString().slice(0, 10);
  const dayStart = midnightMs(date);
  const dayStartSec = Math.floor(dayStart / 1000);

  const [acc] = await db.select({ n: sql<number>`count(*)`, hi: sql<number>`sum(case when icp_score >= 70 then 1 else 0 end)` }).from(schema.accounts);
  const [con] = await db
    .select({
      n: sql<number>`count(*)`,
      verified: sql<number>`sum(case when email_status = 'verified' then 1 else 0 end)`,
      queued: sql<number>`sum(case when status = 'queued' then 1 else 0 end)`,
      inSeq: sql<number>`sum(case when status = 'in_sequence' then 1 else 0 end)`,
      replied: sql<number>`sum(case when status = 'replied' then 1 else 0 end)`,
      activated: sql<number>`sum(case when status = 'activated' then 1 else 0 end)`,
    })
    .from(schema.contacts);
  const [snd] = await db.select({ n: sql<number>`count(*)`, bounced: sql<number>`sum(case when bounced_at is not null then 1 else 0 end)` }).from(schema.sends);
  const [sndToday] = await db.select({ n: sql<number>`count(*)` }).from(schema.sends).where(gte(schema.sends.sentAt, dayStart));

  const replies = await db
    .select({ classification: schema.replies.classification, n: sql<number>`count(*)` })
    .from(schema.replies)
    .groupBy(schema.replies.classification);
  const [repliesToday] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.replies)
    .where(gte(schema.replies.receivedAt, dayStartSec));

  const [signalsToday] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.intentFeed)
    .where(gte(schema.intentFeed.createdAt, dayStartSec));
  const [signalsTotal] = await db.select({ n: sql<number>`count(*)` }).from(schema.intentFeed);
  const [signalsHnToday] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.intentFeed)
    .where(sql`${schema.intentFeed.source} = 'hn' AND ${schema.intentFeed.createdAt} >= ${dayStartSec}`);
  const [signalsRedditToday] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.intentFeed)
    .where(sql`${schema.intentFeed.source} = 'reddit' AND ${schema.intentFeed.createdAt} >= ${dayStartSec}`);

  const inboxes = await db.query.inboxes.findMany();
  const inboxesActive = inboxes.filter((i) => !i.paused).length;
  const inboxesPaused = inboxes.filter((i) => i.paused).length;

  const replyCount = (label: string) => replies.find((r) => r.classification === label)?.n ?? 0;
  const repliesTotal = replies.reduce((sum, r) => sum + (r.n ?? 0), 0);
  const repliesPositive = replyCount('positive');

  const posthog = await fetchPostHogDailyMetrics(date).catch(() => null);
  const campaignDay = await campaignDayNumber();
  const activatedTotal = posthog?.activatedTotal ?? 0;
  const paceTarget = campaignDay !== null ? expectedToday(campaignDay) : '';
  const gapToPace = campaignDay !== null && posthog ? activatedTotal - expectedToday(campaignDay) : '';
  const onPace = campaignDay !== null && posthog ? (activatedTotal >= expectedToday(campaignDay) ? 'YES' : 'NO') : '';
  const milestone = campaignDay !== null ? nextMilestone(campaignDay) : null;

  const inviteAcceptRate =
    posthog && posthog.invitesSentCumulative > 0
      ? pct(posthog.invitesAcceptedCumulative, posthog.invitesSentCumulative)
      : '';
  const kFactor =
    posthog && posthog.signupsCumulative > 0
      ? (posthog.invitesAcceptedCumulative / posthog.signupsCumulative).toFixed(2)
      : '';

  let paceLine = '_Campaign not started — auto go-live will set CAMPAIGN_START when warmup completes_';
  if (campaignDay !== null && posthog && milestone) {
    paceLine = `Day ${campaignDay}/${CAMPAIGN_LENGTH} — next D${milestone.day}=${milestone.target} — ${onPace === 'YES' ? '✅ on pace' : '⚠️ BEHIND'} (gap ${gapToPace})`;
  }

  let activationLine = '_PostHog not configured — product funnel unavailable_';
  if (posthog) {
    activationLine = `Activated: ${posthog.activatedTotal} (+${posthog.activatedToday} today) · Signups: ${posthog.signupsCumulative} (+${posthog.signupsToday}) · K=${kFactor || '—'}`;
  }

  const alarms: string[] = [];
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

  const engineMode = (await isDryRun()) ? 'DRY_RUN' : 'LIVE';
  const sendsTotal = snd.n ?? 0;
  const bounces = snd.bounced ?? 0;

  const row: ScorecardRow = {
    date: dateStr,
    campaign_day: campaignDay ?? '',
    days_remaining: campaignDay !== null ? Math.max(0, CAMPAIGN_LENGTH - campaignDay) : '',
    engine_mode: engineMode,
    activated_total: posthog?.activatedTotal ?? '',
    activated_today: posthog?.activatedToday ?? '',
    pace_target: paceTarget,
    gap_to_pace: gapToPace,
    on_pace: onPace,
    next_milestone_day: milestone?.day ?? '',
    next_milestone_target: milestone?.target ?? '',
    signups_today: posthog?.signupsToday ?? '',
    signups_cumulative: posthog?.signupsCumulative ?? '',
    signups_email_today: posthog?.signupsByChannel.email ?? '',
    signups_community_today: posthog?.signupsByChannel.community ?? '',
    signups_content_today: posthog?.signupsByChannel.content ?? '',
    signups_invite_today: posthog?.signupsByChannel.invite ?? '',
    signups_organic_today: posthog?.signupsByChannel.organic ?? '',
    agents_registered_today: posthog?.agentsRegisteredToday ?? '',
    insights_viewed_today: posthog?.insightsViewedToday ?? '',
    invites_sent_today: posthog?.invitesSentToday ?? '',
    invites_accepted_today: posthog?.invitesAcceptedToday ?? '',
    invites_sent_cumulative: posthog?.invitesSentCumulative ?? '',
    invites_accepted_cumulative: posthog?.invitesAcceptedCumulative ?? '',
    invite_accept_rate_pct: inviteAcceptRate,
    k_factor: kFactor,
    accounts_total: acc.n ?? 0,
    accounts_qualified: acc.hi ?? 0,
    contacts_total: con.n ?? 0,
    contacts_verified: con.verified ?? 0,
    contacts_queued: con.queued ?? 0,
    contacts_in_sequence: con.inSeq ?? 0,
    contacts_replied: con.replied ?? 0,
    contacts_activated: con.activated ?? 0,
    emails_sent_today: sndToday.n ?? 0,
    emails_sent_total: sendsTotal,
    emails_bounced: bounces,
    bounce_rate_pct: pct(bounces, sendsTotal),
    replies_today: repliesToday.n ?? 0,
    replies_total: repliesTotal,
    replies_positive: repliesPositive,
    replies_question: replyCount('question'),
    replies_objection: replyCount('objection'),
    replies_ooo: replyCount('ooo'),
    replies_unsubscribe: replyCount('unsubscribe'),
    positive_reply_rate_pct: pct(repliesPositive, sendsTotal),
    intent_signals_today: signalsToday.n ?? 0,
    intent_signals_cumulative: signalsTotal.n ?? 0,
    intent_signals_hn_today: signalsHnToday.n ?? 0,
    intent_signals_reddit_today: signalsRedditToday.n ?? 0,
    inboxes_active: inboxesActive,
    inboxes_paused: inboxesPaused,
    posthog_dashboard: POSTHOG_DASHBOARD,
    scorecard_sheet: SHEET_URL,
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
      kFactor: kFactor ? Number(kFactor) : null,
      emailsDelivered: sndToday.n ?? null,
      emailReplies: repliesToday.n ?? null,
    })
    .onConflictDoUpdate({
      target: schema.metricsDaily.date,
      set: {
        signups: posthog?.signupsToday ?? null,
        activated: posthog?.activatedToday ?? null,
        activatedCumulative: posthog?.activatedTotal ?? null,
        invitesSent: posthog?.invitesSentToday ?? null,
        invitesAccepted: posthog?.invitesAcceptedToday ?? null,
        kFactor: kFactor ? Number(kFactor) : null,
        emailsDelivered: sndToday.n ?? null,
        emailReplies: repliesToday.n ?? null,
      },
    });

  return { row, paceLine, activationLine, alarms };
}
