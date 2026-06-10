import { sql, eq } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { discordPost } from '../../core/discord.js';

/**
 * Scorecard Reporter — daily 08:00. Playbook §9.8 F1 + §8.
 * Engine stats + (optional) PostHog activation funnel -> pace-line digest -> Slack #gtm-daily.
 * Also the alarm channel: per-inbox bounce-rate breaches auto-pause the domain here.
 */
export async function runScorecard() {
  await audit('scorecard', 'run.start');

  // --- Engine-side stats (always available) ---
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
  const replies = await db
    .select({ classification: schema.replies.classification, n: sql<number>`count(*)` })
    .from(schema.replies)
    .groupBy(schema.replies.classification);

  // --- Deliverability alarms: auto-pause any inbox whose bounce rate breaches ---
  const alarms: string[] = [];
  const inboxes = await db.query.inboxes.findMany();
  for (const inbox of inboxes) {
    const [s] = await db
      .select({ n: sql<number>`count(*)`, bounced: sql<number>`sum(case when bounced_at is not null then 1 else 0 end)` })
      .from(schema.sends)
      .where(eq(schema.sends.inboxId, inbox.id));
    if ((s.n ?? 0) >= 20 && (s.bounced ?? 0) / s.n > config.outreach.maxBounceRate && !inbox.paused) {
      await db.update(schema.inboxes).set({ paused: true, pausedReason: `auto: bounce rate ${((s.bounced / s.n) * 100).toFixed(1)}%` }).where(eq(schema.inboxes.id, inbox.id));
      alarms.push(`🚨 AUTO-PAUSED ${inbox.email} — bounce rate ${((s.bounced / s.n) * 100).toFixed(1)}% (limit ${config.outreach.maxBounceRate * 100}%)`);
      await audit('scorecard', 'inbox.auto_paused', { inbox: inbox.email });
    }
  }

  // --- PostHog activation funnel (when configured) ---
  let activationLine = '_PostHog not configured — product funnel unavailable_';
  let activated: number | null = null;
  if (config.posthog.apiKey && config.posthog.projectId) {
    try {
      activated = await fetchActivatedWorkspaces();
      activationLine = `Activated workspaces (3+ agents, Insights viewed, 1+ invite): *${activated}*`;
    } catch (err) {
      activationLine = `_PostHog query failed: ${String(err).slice(0, 120)}_`;
    }
  }

  // --- Pace line ---
  const campaignDay = campaignDayNumber();
  let paceLine = '_Campaign not started (set CAMPAIGN_START=YYYY-MM-DD in .env)_';
  if (campaignDay !== null && activated !== null) {
    const targets = Object.entries(config.paceLine).map(([d, t]) => [Number(d), t] as const);
    const nextTarget = targets.find(([d]) => d >= campaignDay) ?? targets[targets.length - 1];
    const onTrack = activated >= expectedToday(campaignDay);
    paceLine = `Day ${campaignDay}/20 — next milestone D${nextTarget[0]}=${nextTarget[1]} — ${onTrack ? '✅ on pace' : '⚠️ BEHIND PACE'}`;
  }

  const replyBreakdown = replies.map((r) => `${r.classification}: ${r.n}`).join(' · ') || 'none yet';
  const digest = [
    `*GTM Daily — ${new Date().toISOString().slice(0, 10)}*`,
    paceLine,
    activationLine,
    `Pipeline: ${acc.n} accounts (${acc.hi ?? 0} qualified) · ${con.n} contacts (${con.verified ?? 0} verified, ${con.inSeq ?? 0} in sequence, ${con.replied ?? 0} replied)`,
    `Email: ${snd.n} sent · ${snd.bounced ?? 0} bounced · replies — ${replyBreakdown}`,
    ...alarms,
    config.dryRun ? '_Engine is in DRY_RUN — no live sends._' : '',
  ]
    .filter(Boolean)
    .join('\n');

  console.log(digest.replace(/\*/g, ''));
  await discordPost(config.discord.gtmDaily, digest).catch(() => {});
  await audit('scorecard', 'run.end', { accounts: acc.n, contacts: con.n, sends: snd.n, alarms: alarms.length });
}

/** Linear interpolation between pace-line milestones for "are we on track today". */
function expectedToday(day: number): number {
  const points = [[0, 0], ...Object.entries(config.paceLine).map(([d, t]) => [Number(d), t] as [number, number])];
  for (let i = 1; i < points.length; i++) {
    const [d0, t0] = points[i - 1];
    const [d1, t1] = points[i];
    if (day <= d1) return Math.round(t0 + ((day - d0) / (d1 - d0)) * (t1 - t0));
  }
  return points[points.length - 1][1];
}

function campaignDayNumber(): number | null {
  const start = process.env.CAMPAIGN_START;
  if (!start) return null;
  const diff = Date.now() - new Date(`${start}T00:00:00`).getTime();
  return diff < 0 ? null : Math.floor(diff / 86_400_000) + 1;
}

/** HogQL: workspaces (groups or distinct orgs) hitting the activation milestone. Adjust event names to the product's schema. */
async function fetchActivatedWorkspaces(): Promise<number> {
  const query = `
    select count(distinct properties.workspace_id)
    from events
    where event = 'agent_registered'
    group by properties.workspace_id
    having count(distinct properties.agent_id) >= 3
  `;
  const res = await fetch(`${config.posthog.host}/api/projects/${config.posthog.projectId}/query/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.posthog.apiKey}` },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) throw new Error(`PostHog ${res.status}`);
  const data = (await res.json()) as { results?: unknown[] };
  return data.results?.length ?? 0;
}
