import { config } from './config.js';

export type PostHogDailyMetrics = {
  signupsToday: number;
  signupsCumulative: number;
  activatedTotal: number;
  activatedToday: number;
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

/** Product funnel metrics aligned with the Observal GTM PostHog dashboard. */
export async function fetchPostHogDailyMetrics(date = new Date()): Promise<PostHogDailyMetrics | null> {
  if (!config.posthog.apiKey || !config.posthog.projectId) return null;
  const day = date.toISOString().slice(0, 10);

  const [signupRows, activatedRows, inviteRows] = await Promise.all([
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
  ]);

  return {
    signupsToday: num(signupRows[0], 0),
    signupsCumulative: num(signupRows[0], 1),
    activatedToday: num(activatedRows[0], 0),
    activatedTotal: num(activatedRows[0], 1),
    invitesSentToday: num(inviteRows[0], 0),
    invitesAcceptedToday: num(inviteRows[0], 1),
    invitesSentCumulative: num(inviteRows[0], 2),
    invitesAcceptedCumulative: num(inviteRows[0], 3),
  };
}

export async function fetchActivatedWorkspacesTotal(): Promise<number> {
  const rows = await hogql(`
    SELECT count() AS activated FROM (
      SELECT properties.workspace_id AS ws
      FROM events
      WHERE event = 'agent_registered' AND notEmpty(toString(properties.workspace_id))
      GROUP BY ws
      HAVING countDistinct(toString(properties.agent_id)) >= 3
    )
  `);
  return num(rows[0], 0);
}
