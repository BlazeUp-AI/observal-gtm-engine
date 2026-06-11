import 'dotenv/config';

const DEFAULT_FULL_REVIEW_UNTIL = '2026-06-30';

export const config = {
  dryRun: process.env.DRY_RUN !== 'false', // overridden at runtime by go-live.ts isDryRun()
  autoGoLive: process.env.AUTO_GO_LIVE === 'true',
  databasePath: process.env.DATABASE_PATH ?? './gtm.db',
  port: Number(process.env.PORT ?? 3000),

  gemini: {
    apiKey: required('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    modelQa: process.env.GEMINI_MODEL_QA ?? 'gemini-2.5-flash-lite',
  },

  composio: {
    apiKey: required('COMPOSIO_API_KEY'),
  },

  agentmail: {
    apiKey: process.env.AGENTMAIL_API_KEY ?? '', // email layer: send, receive, domains, inboxes
  },

  githubToken: process.env.GITHUB_TOKEN ?? '', // free PAT; gates the GitHub source + commit-email discovery

  posthog: {
    apiKey: process.env.POSTHOG_API_KEY ?? '',
    projectId: process.env.POSTHOG_PROJECT_ID ?? '',
    host: process.env.POSTHOG_HOST ?? 'https://us.posthog.com',
  },

  sheets: {
    spreadsheetId: process.env.GOOGLE_SHEETS_ID ?? '1khilsBPv1RVBxYyu5AE5HI_0toF2V-po97xHxHT86l4',
    scorecardTab: process.env.GOOGLE_SHEETS_SCORECARD_TAB ?? 'Daily Scorecard',
    outcomesTab: process.env.GOOGLE_SHEETS_OUTCOMES_TAB ?? 'Outcomes',
    leadsTab: process.env.GOOGLE_SHEETS_LEADS_TAB ?? 'Leads',
    leadsPoc: process.env.LEADS_POC ?? 'Aryan',
  },

  reacherUrl: process.env.REACHER_URL ?? 'http://localhost:8080',

  discord: {
    // One channel webhook URL per agent surface (channel settings -> Integrations -> Webhooks)
    signals: process.env.DISCORD_WEBHOOK_SIGNALS ?? '',
    replies: process.env.DISCORD_WEBHOOK_REPLIES ?? '',
    newSignups: process.env.DISCORD_WEBHOOK_NEW_SIGNUPS ?? '',
    gtmDaily: process.env.DISCORD_WEBHOOK_GTM_DAILY ?? '',
    // Slash-command app (/draft): https://discord.com/developers/applications
    appId: process.env.DISCORD_APP_ID ?? '',
    publicKey: process.env.DISCORD_PUBLIC_KEY ?? '',
    botToken: process.env.DISCORD_BOT_TOKEN ?? '', // only used by scripts/register-discord-commands.cjs
  },

  outreach: {
    // Ramp: day N of an inbox's life -> daily cap. Playbook 9.4: 10/day start, +5/day, ceiling 40.
    rampCapForDay: (dayOfRamp: number) => Math.min(10 + Math.max(0, dayOfRamp - 1) * 5, 40),
    // Inboxes younger than this send warmup traffic ONLY — no cold email.
    warmupOnlyDays: 5,
    sendWindow: { startHour: 8, endHour: 17 }, // prospect-local
    minGapMinutes: 3,
    maxGapMinutes: 9,
    // Auto-pause thresholds (playbook 9.11)
    maxBounceRate: 0.03,
    maxSpamRate: 0.001,
    // Review gate: line-by-line approval before this date, 10% sampling after
    fullReviewUntil: process.env.FULL_REVIEW_UNTIL ?? DEFAULT_FULL_REVIEW_UNTIL,
    samplingRate: 0.1,
    maxWords: 100,
  },

  warmup: {
    // Daily warmup volume per inbox: starts small, grows with ramp day.
    targetForDay: (dayOfRamp: number) => Math.min(2 + dayOfRamp, 8),
    replyProbability: 0.45, // chance a warmup recipient replies (engagement signal)
    // Extra external addresses to include in warmup rotation (comma-separated).
    // Use personal Gmail/Outlook accounts you control and will open/reply from.
    seedEmails: (process.env.WARMUP_SEED_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  paceLine: { 10: 50, 16: 130, 20: 200 } as Record<number, number>,

  bannedWords: [
    'revolutionize', 'streamline', 'supercharge', 'unlock', 'leverage',
    'game-changing', 'cutting-edge', 'seamless', 'empower', 'synergy',
  ],

  icpKeywords: [
    'prompt versioning', 'track agents', 'agent inventory', 'agent audit',
    'agent governance', 'which agents', 'agent registry', 'agent sprawl',
  ],

  signalScout: {
    redditEnabled: process.env.SIGNAL_SCOUT_REDDIT !== 'false',
    redditSubreddits: (process.env.SIGNAL_SCOUT_REDDIT_SUBS ?? 'AI_Agents,LangChain').split(',').map((s) => s.trim()).filter(Boolean),
    linkedinEnabled: process.env.SIGNAL_SCOUT_LINKEDIN !== 'false',
  },
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.warn(`[config] Missing required env var ${name} — agents needing it will fail until set.`);
    return '';
  }
  return v;
}
