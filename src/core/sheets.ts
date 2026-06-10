import { eq } from 'drizzle-orm';
import { audit } from './audit.js';
import { config } from './config.js';
import { db, schema } from './db.js';
import { ENTITY, getComposio } from './composio.js';

export const SCORECARD_COLUMNS = [
  'date',
  'campaign_day',
  'engine_mode',
  'on_pace',
  'pace_target',
  'signups_today',
  'signups_cumulative',
  'activated_today',
  'activated_total',
  'invites_sent_today',
  'invites_accepted_today',
  'accounts_total',
  'accounts_qualified',
  'contacts_total',
  'contacts_verified',
  'contacts_in_sequence',
  'contacts_replied',
  'emails_sent_today',
  'emails_sent_total',
  'emails_bounced',
  'replies_positive',
  'replies_question',
  'replies_objection',
  'replies_ooo',
  'replies_unsubscribe',
  'intent_signals_today',
  'posthog_dashboard',
] as const;

export type ScorecardRow = Record<(typeof SCORECARD_COLUMNS)[number], string | number>;

const OUTCOMES_COLUMNS = ['timestamp', 'outcome_type', 'summary', 'entity', 'url', 'source'] as const;
export type OutcomeRow = Record<(typeof OUTCOMES_COLUMNS)[number], string>;

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

export async function ensureScorecardSheet(): Promise<void> {
  if (!config.sheets.spreadsheetId) return;
  if (await getSetting('sheets_headers_initialized')) return;

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

  await setSetting('sheets_headers_initialized', 'true');
  await audit('sheets', 'headers.initialized', { spreadsheetId: config.sheets.spreadsheetId });
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

  const values = [SCORECARD_COLUMNS.map((col) => row[col] ?? '')];

  await executeTool('GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND', {
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.scorecardTab}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    values,
  });

  await setSetting('sheets_last_sync_date', String(row.date));
  await audit('sheets', 'scorecard.appended', { date: row.date });
}

export async function appendOutcomeRow(row: OutcomeRow): Promise<void> {
  if (!config.sheets.spreadsheetId) return;

  const composio = getComposio();
  if (!composio) return;

  const connected = await composio.connectedAccounts.list({ userIds: [ENTITY.system], toolkitSlugs: ['googlesheets'] });
  if (!connected.items.some((a) => a.status === 'ACTIVE')) return;

  await ensureScorecardSheet();

  await executeTool('GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND', {
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.outcomesTab}!A:F`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    values: [[OUTCOMES_COLUMNS.map((col) => row[col] ?? '')]],
  });
}
