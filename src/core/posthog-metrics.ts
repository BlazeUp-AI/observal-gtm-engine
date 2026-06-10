import { config } from './config.js';

export type SignupsByChannel = {
  email: number;
  community: number;
  content: number;
  invite: number;
  organic: number;
};

export type PostHogDailyMetrics = {
  signupsToday: number;
  signupsCumulative: number;
  signupsByChannel: SignupsByChannel;
  activatedTotal: number;
  activatedToday: number;
  agentsRegisteredToday: number;
  insightsViewedToday: number;
  invitesSentToday: number;
  invitesAcceptedToday: number;
  invitesSentCumulative: number;
  invitesAcceptedCumulative: number;
};

async function hogql(query: string): Promise<unknown[][]> {
  if (!config.posthog.apiKey || !config.posthog.projectId) {
    throw new Error('PostHog not configured');
  }
  const res = await fetch(`${config.posthog.host}/api/projects/${config.posthog.projectId}/query/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.posthog.apiKey}` },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) throw new Error(`PostHog ${res.status}`);
  const data = (await res.json()) as { results?: unknown[][] };
  return data.results ?? [];
}

function num(row: unknown[] | undefined, idx = 0): number {
  const v = row?.[idx];
  return typeof v === 'number' ? v : Number(v ?? 0);
}

function bucketSignupChannel(utmSource: string, utmMedium: string): keyof SignupsByChannel {
  const src = utmSource.toLowerCase();
  const med = utmMedium.toLowerCase();
  if (med === 'email' || ['outreach', 'email', 'cold_email', 'cold-email'].includes(src)) return 'email';
  if (['community', 'hn', 'reddit', 'discord', 'slack', 'twitter', 'x'].includes(src)) return 'community';
  if (['content', 'blog', 'seo', 'newsletter'].includes(src)) return 'content';
  if (['invite', 'referral', 'ref'].includes(src)) return 'invite';
  return 'organic';
}

async function fetchSignupsByChannel(day: string): Promise<SignupsByChannel> {
  const rows = await hogql(`
    SELECT
      coalesce(toString(properties.utm_source), '') AS utm_source,
      coalesce(toString(properties.utm_medium), '') AS utm_medium,
      count() AS n
    FROM events
    WHERE event = 'user_signed_up' AND toDate(timestamp) = toDate('${day}')
    GROUP BY utm_source, utm_medium
  `);

  const out: SignupsByChannel = { email: 0, community: 0, content: 0, invite: 0, organic: 0 };
  for (const row of rows) {
    const bucket = bucketSignupChannel(String(row[0] ?? ''), String(row[1] ?? ''));
    out[bucket] += num(row, 2);
  }
  return out;
}

/** Product funnel metrics aligned with the Observal GTM PostHog dashboard. */
export async function fetchPostHogDailyMetrics(date = new Date()): Promise<PostHogDailyMetrics | null> {
  if (!config.posthog.apiKey || !config.posthog.projectId) return null;
  const day = date.toISOString().slice(0, 10);

  const [signupRows, activatedRows, inviteRows, funnelRows, signupsByChannel] = await Promise.all([
    hogql(`
      SELECT
        countIf(toDate(timestamp) = toDate('${day}')) AS today,
        count() AS cumulative
      FROM events
      WHERE event = 'user_signed_up'
    `),
    hogql(`
      SELECT
        countIf(toDate(ts) = toDate('${day}')) AS today,
        count() AS cumulative
      FROM (
        SELECT properties.workspace_id AS ws, min(timestamp) AS ts
        FROM events
        WHERE event = 'agent_registered' AND notEmpty(toString(properties.workspace_id))
        GROUP BY ws
        HAVING countDistinct(toString(properties.agent_id)) >= 3
      )
    `),
    hogql(`
      SELECT
        countIf(event = 'invite_sent' AND toDate(timestamp) = toDate('${day}')) AS sent_today,
        countIf(event = 'invite_accepted' AND toDate(timestamp) = toDate('${day}')) AS accepted_today,
        countIf(event = 'invite_sent') AS sent_total,
        countIf(event = 'invite_accepted') AS accepted_total
      FROM events
      WHERE event IN ('invite_sent', 'invite_accepted')
    `),
    hogql(`
      SELECT
        countIf(event = 'agent_registered' AND toDate(timestamp) = toDate('${day}')) AS agents_today,
        countIf(event = 'insights_viewed' AND toDate(timestamp) = toDate('${day}')) AS insights_today
      FROM events
      WHERE event IN ('agent_registered', 'insights_viewed')
    `),
    fetchSignupsByChannel(day),
  ]);

  return {
    signupsToday: num(signupRows[0], 0),
    signupsCumulative: num(signupRows[0], 1),
    signupsByChannel,
    activatedToday: num(activatedRows[0], 0),
    activatedTotal: num(activatedRows[0], 1),
    agentsRegisteredToday: num(funnelRows[0], 0),
    insightsViewedToday: num(funnelRows[0], 1),
    invitesSentToday: num(inviteRows[0], 0),
    invitesAcceptedToday: num(inviteRows[0], 1),
    invitesSentCumulative: num(inviteRows[0], 2),
    invitesAcceptedCumulative: num(inviteRows[0], 3),
  };
}
