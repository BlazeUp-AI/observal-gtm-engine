import { eq } from 'drizzle-orm';
import { audit } from './audit.js';
import { config } from './config.js';
import { db, schema } from './db.js';
import { ENTITY, getComposio } from './composio.js';
import { campaignDayNumber, isDryRun } from './go-live.js';

/** Bump when columns change — rewrites header row on next sync. */
export const SHEETS_SCHEMA_VERSION = '3';

/**
 * Daily Scorecard — one row per day. Grouped to match playbook §8 + PostHog dashboard.
 * @see SETUP.md §6d for column definitions
 */
export const SCORECARD_COLUMNS = [
  // --- meta ---
  'date',
  'campaign_day',
  'days_remaining',
  'engine_mode',
  // --- north star / pace ---
  'activated_total',
  'activated_today',
  'pace_target',
  'gap_to_pace',
  'on_pace',
  'next_milestone_day',
  'next_milestone_target',
  // --- product funnel (PostHog) ---
  'signups_today',
  'signups_cumulative',
  'signups_email_today',
  'signups_community_today',
  'signups_content_today',
  'signups_invite_today',
  'signups_organic_today',
  'agents_registered_today',
  'insights_viewed_today',
  // --- viral loop ---
  'invites_sent_today',
  'invites_accepted_today',
  'invites_sent_cumulative',
  'invites_accepted_cumulative',
  'invite_accept_rate_pct',
  'k_factor',
  // --- prospect pipeline (engine) ---
  'accounts_total',
  'accounts_qualified',
  'contacts_total',
  'contacts_verified',
  'contacts_queued',
  'contacts_in_sequence',
  'contacts_replied',
  'contacts_activated',
  // --- email outreach ---
  'emails_sent_today',
  'emails_sent_total',
  'emails_bounced',
  'bounce_rate_pct',
  'replies_today',
  'replies_total',
  'replies_positive',
  'replies_question',
  'replies_objection',
  'replies_ooo',
  'replies_unsubscribe',
  'positive_reply_rate_pct',
  // --- community intent ---
  'intent_signals_today',
  'intent_signals_cumulative',
  'intent_signals_hn_today',
  'intent_signals_reddit_today',
  // --- deliverability ---
  'inboxes_active',
  'inboxes_paused',
  // --- links ---
  'posthog_dashboard',
  'scorecard_sheet',
] as const;

export type ScorecardRow = Record<(typeof SCORECARD_COLUMNS)[number], string | number>;

export const OUTCOMES_COLUMNS = [
  'timestamp',
  'date',
  'campaign_day',
  'outcome_type',
  'summary',
  'entity',
  'company',
  'channel',
  'url',
  'source',
  'relevance_score',
  'engine_mode',
] as const;

export type OutcomeRow = Record<(typeof OUTCOMES_COLUMNS)[number], string>;

export async function defaultOutcomeMeta(): Promise<Pick<OutcomeRow, 'date' | 'campaign_day' | 'engine_mode'>> {
  return {
    date: new Date().toISOString().slice(0, 10),
    campaign_day: String((await campaignDayNumber()) ?? ''),
    engine_mode: (await isDryRun()) ? 'DRY_RUN' : 'LIVE',
  };
}

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${config.sheets.spreadsheetId}/edit`;

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

async function executeTool(slug: string, arguments_: Record<string, unknown>) {
  const composio = getComposio();
  if (!composio) throw new Error('COMPOSIO_API_KEY missing');
  return composio.tools.execute(slug, { userId: ENTITY.system, arguments: arguments_ });
}

export function scorecardRowToValues(row: ScorecardRow): (string | number)[] {
  return SCORECARD_COLUMNS.map((col) => row[col] ?? '');
}

export async function ensureScorecardSheet(): Promise<void> {
  if (!config.sheets.spreadsheetId) return;
  if ((await getSetting('sheets_schema_version')) === SHEETS_SCHEMA_VERSION) return;

  await executeTool('GOOGLESHEETS_BATCH_UPDATE', {
    spreadsheet_id: config.sheets.spreadsheetId,
    sheet_name: config.sheets.scorecardTab,
    first_cell_location: 'A1',
    valueInputOption: 'USER_ENTERED',
    values: [SCORECARD_COLUMNS as unknown as string[]],
  });

  await executeTool('GOOGLESHEETS_BATCH_UPDATE', {
    spreadsheet_id: config.sheets.spreadsheetId,
    sheet_name: config.sheets.outcomesTab,
    first_cell_location: 'A1',
    valueInputOption: 'USER_ENTERED',
    values: [OUTCOMES_COLUMNS as unknown as string[]],
  });

  await setSetting('sheets_schema_version', SHEETS_SCHEMA_VERSION);
  await audit('sheets', 'headers.initialized', { version: SHEETS_SCHEMA_VERSION, spreadsheetId: config.sheets.spreadsheetId });
}

export async function appendScorecardRow(row: ScorecardRow): Promise<void> {
  if (!config.sheets.spreadsheetId) return;

  const composio = getComposio();
  if (!composio) {
    await audit('sheets', 'sync.skipped', { reason: 'COMPOSIO_API_KEY missing' });
    return;
  }

  const connected = await composio.connectedAccounts.list({ userIds: [ENTITY.system], toolkitSlugs: ['googlesheets'] });
  const active = connected.items.find((a) => a.status === 'ACTIVE');
  if (!active) {
    await audit('sheets', 'sync.skipped', { reason: 'Google Sheets not connected — run: npm run composio:sheets' });
    return;
  }

  await ensureScorecardSheet();

  await executeTool('GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND', {
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.scorecardTab}!A:AZ`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    values: [scorecardRowToValues(row)],
  });

  await setSetting('sheets_last_sync_date', String(row.date));
  await audit('sheets', 'scorecard.appended', { date: row.date });
}

export async function appendOutcomeRow(row: Partial<OutcomeRow> & Pick<OutcomeRow, 'outcome_type' | 'summary' | 'entity'>): Promise<void> {
  if (!config.sheets.spreadsheetId) return;

  const composio = getComposio();
  if (!composio) return;

  const connected = await composio.connectedAccounts.list({ userIds: [ENTITY.system], toolkitSlugs: ['googlesheets'] });
  if (!connected.items.some((a) => a.status === 'ACTIVE')) return;

  await ensureScorecardSheet();

  const full: OutcomeRow = {
    timestamp: row.timestamp ?? new Date().toISOString(),
    date: row.date ?? new Date().toISOString().slice(0, 10),
    campaign_day: row.campaign_day ?? '',
    outcome_type: row.outcome_type,
    summary: row.summary,
    entity: row.entity,
    company: row.company ?? '',
    channel: row.channel ?? '',
    url: row.url ?? '',
    source: row.source ?? '',
    relevance_score: row.relevance_score ?? '',
    engine_mode: row.engine_mode ?? '',
  };

  await executeTool('GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND', {
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.outcomesTab}!A:L`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    values: [OUTCOMES_COLUMNS.map((col) => full[col] ?? '')],
  });
}

export { SHEET_URL };
