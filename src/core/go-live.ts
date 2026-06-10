import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from './db.js';
import { audit } from './audit.js';
import { config } from './config.js';
import { discordPost } from './discord.js';

const DAY = 86_400_000;
const DEFAULT_FULL_REVIEW_UNTIL = '2026-06-30';

export type WarmupStatus = {
  ready: boolean;
  reason: string;
  inboxes: { email: string; rampDay: number }[];
};

async function getSetting(key: string): Promise<string | null> {
  const row = await db.query.engineSettings.findFirst({ where: eq(schema.engineSettings.key, key) });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string) {
  await db
    .insert(schema.engineSettings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.engineSettings.key, set: { value, updatedAt: Date.now() } });
}

/** Live when go-live fired in DB, or DRY_RUN=false was set explicitly in env. */
export async function isDryRun(): Promise<boolean> {
  if (process.env.DRY_RUN === 'false') return false;
  const goLiveAt = await getSetting('go_live_at');
  return !goLiveAt;
}

export async function getCampaignStart(): Promise<string | null> {
  return (await getSetting('campaign_start')) ?? process.env.CAMPAIGN_START ?? null;
}

export async function getFullReviewUntil(): Promise<string> {
  return process.env.FULL_REVIEW_UNTIL || (await getSetting('full_review_until')) || DEFAULT_FULL_REVIEW_UNTIL;
}

export async function assessWarmupReadiness(): Promise<WarmupStatus> {
  const all = await db.query.inboxes.findMany();
  if (all.length === 0) {
    return { ready: false, reason: 'no inboxes provisioned', inboxes: [] };
  }

  const active = all.filter((i) => !i.paused);
  if (active.length === 0) {
    return { ready: false, reason: 'all inboxes paused', inboxes: [] };
  }

  const inboxes = active.map((inbox) => {
    const rampDay = inbox.rampStartedAt ? Math.floor((Date.now() - inbox.rampStartedAt) / DAY) + 1 : 1;
    return { email: inbox.email, rampDay };
  });

  const warming = inboxes.filter((i) => i.rampDay <= config.outreach.warmupOnlyDays);
  if (warming.length > 0) {
    return {
      ready: false,
      reason: `${warming.length} inbox(es) still warmup-only (need ramp day > ${config.outreach.warmupOnlyDays})`,
      inboxes,
    };
  }

  return { ready: true, reason: 'all active inboxes past warmup-only window', inboxes };
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function envFilePath(): string {
  return process.env.ENV_FILE ?? path.join(process.cwd(), '.env');
}

/** Keep .env in sync for ops visibility; also updates this process's env. */
function patchEnvFile(updates: Record<string, string>) {
  const file = envFilePath();
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    for (const [key, value] of Object.entries(updates)) {
      const re = new RegExp(`^${key}=.*$`, 'm');
      content = re.test(content) ? content.replace(re, `${key}=${value}`) : `${content.trimEnd()}\n${key}=${value}\n`;
    }
    fs.writeFileSync(file, content);
  }
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}

export async function getGoLiveStatus() {
  const warmup = await assessWarmupReadiness();
  return {
    autoGoLive: config.autoGoLive,
    dryRun: await isDryRun(),
    goLiveAt: await getSetting('go_live_at'),
    campaignStart: await getCampaignStart(),
    fullReviewUntil: await getFullReviewUntil(),
    warmup,
  };
}

/**
 * When AUTO_GO_LIVE=true and every active inbox is past the warmup-only window,
 * flip live mode automatically — no manual SSH or systemd edits.
 */
export async function maybeAutoGoLive(): Promise<boolean> {
  if (!config.autoGoLive) return false;
  if (await getSetting('go_live_at')) return false;

  const warmup = await assessWarmupReadiness();
  if (!warmup.ready) return false;

  if (!config.agentmail.apiKey) {
    await audit('go-live', 'blocked', { reason: 'AGENTMAIL_API_KEY missing' });
    return false;
  }

  const now = new Date().toISOString();
  const campaignStart = todayIsoDate();
  const fullReviewUntil = await getFullReviewUntil();

  await setSetting('go_live_at', now);
  await setSetting('campaign_start', campaignStart);
  if (!process.env.FULL_REVIEW_UNTIL) {
    await setSetting('full_review_until', fullReviewUntil);
  }

  patchEnvFile({
    DRY_RUN: 'false',
    CAMPAIGN_START: campaignStart,
    FULL_REVIEW_UNTIL: fullReviewUntil,
  });

  await audit('go-live', 'activated', { at: now, campaignStart, fullReviewUntil, inboxes: warmup.inboxes });

  const digest = [
    '*GTM engine is LIVE* — auto go-live triggered',
    `Campaign start: ${campaignStart} · full human review until ${fullReviewUntil}`,
    `Inboxes: ${warmup.inboxes.map((i) => `${i.email} (day ${i.rampDay})`).join(', ')}`,
    '_Outreach sends real email on the next cycle — no manual VM steps needed._',
  ].join('\n');

  console.log(digest.replace(/\*/g, ''));
  await discordPost(config.discord.gtmDaily, digest).catch(() => {});
  return true;
}
