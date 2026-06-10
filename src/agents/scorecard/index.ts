import { audit } from '../../core/audit.js';
import { discordPost } from '../../core/discord.js';
import { config } from '../../core/config.js';
import { isDryRun } from '../../core/go-live.js';
import { appendScorecardRow } from '../../core/sheets.js';
import { collectDailyScorecard } from './collect.js';

/**
 * Scorecard Reporter — daily 08:00. Playbook §9.8 F1 + §8.
 * Engine stats + PostHog funnel -> Discord digest -> Google Sheets row.
 */
export async function runScorecard() {
  await audit('scorecard', 'run.start');

  const { row, paceLine, activationLine, alarms } = await collectDailyScorecard();

  const replyBreakdown = [
    row.replies_positive ? `positive: ${row.replies_positive}` : null,
    row.replies_question ? `question: ${row.replies_question}` : null,
    row.replies_objection ? `objection: ${row.replies_objection}` : null,
  ]
    .filter(Boolean)
    .join(' · ') || 'none yet';

  const digest = [
    `*GTM Daily — ${row.date}*`,
    paceLine,
    activationLine,
    `Pipeline: ${row.accounts_total} accounts (${row.accounts_qualified} qualified) · ${row.contacts_total} contacts (${row.contacts_verified} verified, ${row.contacts_in_sequence} in sequence, ${row.contacts_replied} replied)`,
    `Email: ${row.emails_sent_total} sent (${row.emails_sent_today} today) · ${row.emails_bounced} bounced · replies — ${replyBreakdown}`,
    row.intent_signals_today ? `Intent signals today: ${row.intent_signals_today}` : null,
    ...alarms,
    ...(await isDryRun() ? ['_Engine is in DRY_RUN — no live sends._'] : []),
    config.sheets.spreadsheetId ? `_Scorecard synced to Google Sheets._` : null,
  ]
    .filter(Boolean)
    .join('\n');

  console.log(digest.replace(/\*/g, ''));
  await discordPost(config.discord.gtmDaily, digest).catch(() => {});

  try {
    await appendScorecardRow(row);
  } catch (err) {
    await audit('scorecard', 'sheets.failed', { error: String(err).slice(0, 200) });
  }

  await audit('scorecard', 'run.end', {
    accounts: row.accounts_total,
    contacts: row.contacts_total,
    sends: row.emails_sent_total,
    alarms: alarms.length,
  });
}
