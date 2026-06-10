import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { isDryRun, maybeAutoGoLive } from '../../core/go-live.js';

import { enqueueNewContacts, processDueSequences } from './machine.js';

/**
 * Outreach Engine — every 30 min inside the send window. Playbook §9.4 (B1–B4).
 * Guards enforced in machine.ts, in order: suppression -> inbox ramp/caps/paused ->
 * thin-signal manual lane -> QA -> DRY_RUN. Sends only via per-inbox AgentMail addresses.
 * Remaining TODO: Google Sheets review gate (currently the thin-signal lane + DRY_RUN
 * cover review; the Sheets approve-column flow lands with the first live batch).
 */
export async function runOutreach() {
  await maybeAutoGoLive();
  await audit('outreach', 'run.start', { dryRun: await isDryRun() });
  const enqueued = await enqueueNewContacts();
  const { sent, blocked } = await processDueSequences();
  await audit('outreach', 'run.end', { enqueued, sent, blocked, dryRun: await isDryRun() });
}
