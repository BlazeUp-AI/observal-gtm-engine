import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { config } from './config.js';

/**
 * Composio is the auth + execution layer for external tools that need OAuth:
 * Reddit/X/GitHub (search), Google Sheets (views).
 * Email lives on AgentMail (core/agentmail.ts); Discord uses plain webhooks (core/discord.ts).
 */
let _composio: Composio<VercelProvider> | null = null;

/** Lazy init — the engine must boot (and dry-run) before keys are configured. */
export function getComposio(): Composio<VercelProvider> | null {
  if (!config.composio.apiKey) return null;
  _composio ??= new Composio({
    apiKey: config.composio.apiKey,
    provider: new VercelProvider(),
    toolkitVersions: { reddit: '00000000_00', googlesheets: '00000000_00' },
  });
  return _composio;
}

export const ENTITY = {
  system: 'gtm-engine', // Sheets, GitHub, Reddit, X
};

/** True when Composio has an ACTIVE connected account for the toolkit (e.g. reddit). */
export async function isToolkitConnected(toolkitSlug: string): Promise<boolean> {
  const composio = getComposio();
  if (!composio) return false;
  const connected = await composio.connectedAccounts.list({ userIds: [ENTITY.system], toolkitSlugs: [toolkitSlug] });
  return connected.items.some((a) => a.status === 'ACTIVE');
}
