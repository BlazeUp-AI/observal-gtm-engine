import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { config } from './config.js';

/**
 * Composio is the auth + execution layer for every external tool:
 * Gmail (send/read), Slack (post), Reddit/X/GitHub (search), Google Sheets (views).
 * One user id per logical identity; outreach inboxes each get their own connected account.
 */
let _composio: Composio<VercelProvider> | null = null;

/** Lazy init — the engine must boot (and dry-run) before keys are configured. */
export function getComposio(): Composio<VercelProvider> | null {
  if (!config.composio.apiKey) return null;
  _composio ??= new Composio({
    apiKey: config.composio.apiKey,
    provider: new VercelProvider(),
  });
  return _composio;
}

export const ENTITY = {
  system: 'gtm-engine', // Slack, Sheets, GitHub, Reddit, X
  inbox: (email: string) => `inbox:${email}`, // per-inbox Gmail connections
};

/** Post a message to a Slack channel via Composio's Slack tool. */
export async function slackPost(channel: string, text: string) {
  const composio = getComposio();
  if (!composio || !channel) {
    console.log(`[slack:skipped — ${!composio ? 'no COMPOSIO_API_KEY' : 'no channel configured'}] ${text.slice(0, 200)}`);
    return;
  }
  await composio.tools.execute('SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL', {
    userId: ENTITY.system,
    arguments: { channel, text, markdown_text: text },
  });
}
