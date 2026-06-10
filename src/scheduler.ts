import cron from 'node-cron';
import { runProspector } from './agents/prospector/index.js';
import { runOutreach } from './agents/outreach/index.js';
import { runSignalScout } from './agents/signal-scout/index.js';
import { runReplyTriager } from './agents/reply-triager/index.js';
import { runScorecard } from './agents/scorecard/index.js';
import { runWarmup } from './agents/warmup/index.js';
import { config } from './core/config.js';
import { db, schema } from './core/db.js';
import { isDryRun, maybeAutoGoLive } from './core/go-live.js';

const dryRun = await isDryRun();
console.log(`gtm-engine scheduler starting (DRY_RUN=${dryRun}, AUTO_GO_LIVE=${config.autoGoLive})`);
await maybeAutoGoLive();

// All schedules in one place — playbook §9.2.
cron.schedule('0 2 * * *', () => safe('prospector', runProspector)); // nightly 02:00
cron.schedule('*/30 8-17 * * *', () => safe('outreach', runOutreach)); // every 30 min, send window
cron.schedule('0 * * * *', () => safe('signal-scout', runSignalScout)); // hourly
cron.schedule('*/5 * * * *', () => safe('reply-triager', runReplyTriager)); // every 5 min
cron.schedule('0 8 * * *', () => safe('scorecard', runScorecard)); // daily 08:00
cron.schedule('17 8-18/2 * * *', () => safe('warmup', runWarmup)); // every 2h in window (offset to avoid colliding with outreach)
cron.schedule('5 * * * *', () => safe('go-live', async () => { await maybeAutoGoLive(); }));
cron.schedule('0 0 * * *', () => safe('daily-reset', resetDailyCounters)); // midnight

async function resetDailyCounters() {
  await db.update(schema.inboxes).set({ sentToday: 0 });
  console.log('[daily-reset] inbox sentToday counters reset');
}

async function safe(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[${name}] failed:`, err);
  }
}
