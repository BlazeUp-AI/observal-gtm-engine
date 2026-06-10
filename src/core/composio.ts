import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { config } from './config.js';

/**
 * Composio is the auth + execution layer for external tools that need OAuth:
 * Gmail (send/read), Reddit/X/GitHub (search), Google Sheets (views).
 * Discord notifications bypass Composio entirely — see core/discord.ts (plain webhooks).
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
  system: 'gtm-engine', // Sheets, GitHub, Reddit, X
  inbox: (email: string) => `inbox:${email}`, // per-inbox Gmail connections
};
