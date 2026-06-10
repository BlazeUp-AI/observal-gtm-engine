import cron from 'node-cron';
import { runProspector } from './agents/prospector/index.js';
import { runOutreach } from './agents/outreach/index.js';
import { runSignalScout } from './agents/signal-scout/index.js';
import { runReplyTriager } from './agents/reply-triager/index.js';
import { runScorecard } from './agents/scorecard/index.js';
import { config } from './core/config.js';

console.log(`gtm-engine scheduler starting (DRY_RUN=${config.dryRun})`);

// All schedules in one place — playbook §9.2.
cron.schedule('0 2 * * *', () => safe('prospector', runProspector)); // nightly 02:00
cron.schedule('*/30 8-17 * * *', () => safe('outreach', runOutreach)); // every 30 min, send window
cron.schedule('0 * * * *', () => safe('signal-scout', runSignalScout)); // hourly
cron.schedule('*/5 * * * *', () => safe('reply-triager', runReplyTriager)); // every 5 min
cron.schedule('0 8 * * *', () => safe('scorecard', runScorecard)); // daily 08:00

async function safe(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[${name}] failed:`, err);
  }
}
