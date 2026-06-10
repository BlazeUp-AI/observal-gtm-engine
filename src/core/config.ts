import 'dotenv/config';

export const config = {
  dryRun: process.env.DRY_RUN !== 'false', // live sending requires explicit DRY_RUN=false
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

  githubToken: process.env.GITHUB_TOKEN ?? '', // free PAT; gates the GitHub source + commit-email discovery

  posthog: {
    apiKey: process.env.POSTHOG_API_KEY ?? '',
    projectId: process.env.POSTHOG_PROJECT_ID ?? '',
    host: process.env.POSTHOG_HOST ?? 'https://us.posthog.com',
  },

  reacherUrl: process.env.REACHER_URL ?? 'http://localhost:8080',

  slack: {
    signals: process.env.SLACK_CHANNEL_SIGNALS ?? '',
    replies: process.env.SLACK_CHANNEL_REPLIES ?? '',
    newSignups: process.env.SLACK_CHANNEL_NEW_SIGNUPS ?? '',
    gtmDaily: process.env.SLACK_CHANNEL_GTM_DAILY ?? '',
  },

  outreach: {
    // Ramp: day N of an inbox's life -> daily cap. Playbook 9.4: 10/day start, +5/day, ceiling 40.
    rampCapForDay: (dayOfRamp: number) => Math.min(10 + Math.max(0, dayOfRamp - 1) * 5, 40),
    sendWindow: { startHour: 8, endHour: 17 }, // prospect-local
    minGapMinutes: 3,
    maxGapMinutes: 9,
    // Auto-pause thresholds (playbook 9.11)
    maxBounceRate: 0.03,
    maxSpamRate: 0.001,
    // Review gate: line-by-line approval before this date, 10% sampling after
    fullReviewUntil: process.env.FULL_REVIEW_UNTIL ?? '', // YYYY-MM-DD; empty = always full review
    samplingRate: 0.1,
    maxWords: 100,
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
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.warn(`[config] Missing required env var ${name} — agents needing it will fail until set.`);
    return '';
  }
  return v;
}
