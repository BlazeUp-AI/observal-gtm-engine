/**
 * Composio OAuth setup for gtm-engine entity connections.
 * Usage: npx tsx scripts/setup-composio.ts [status|reddit|sheets]
 */
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { ENTITY } from '../src/core/composio.js';

const USER_ID = ENTITY.system;

async function connectToolkit(
  composio: Composio<VercelProvider>,
  toolkitSlug: string,
  label: string,
) {
  const configs = await composio.authConfigs.list({ toolkitSlugs: [toolkitSlug] });
  const authConfig = configs.items[0];
  if (!authConfig) {
    console.error(`No ${label} auth config found. Create one at https://app.composio.dev`);
    process.exit(1);
  }

  const existing = await composio.connectedAccounts.list({ userIds: [USER_ID], toolkitSlugs: [toolkitSlug] });
  const active = existing.items.find((a) => a.status === 'ACTIVE');
  if (active) {
    console.log(`${label} already connected: ${active.id}`);
    return;
  }

  const req = await composio.connectedAccounts.link(USER_ID, authConfig.id, {
    callbackUrl: 'https://gtm.useobserval.xyz/health',
  });
  console.log(`\nOpen this URL to connect ${label}:\n`);
  console.log(req.redirectUrl);
  console.log('\nWaiting for connection (up to 5 min)...');
  const connected = await req.waitForConnection(300_000);
  console.log(`Connected: ${connected.id} (${connected.status})`);
}

async function main() {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.error('Set COMPOSIO_API_KEY in .env first.');
    process.exit(1);
  }

  const composio = new Composio({
    apiKey,
    provider: new VercelProvider(),
    toolkitVersions: { reddit: '00000000_00', googlesheets: '00000000_00' },
  });
  const cmd = process.argv[2] ?? 'status';

  if (cmd === 'status') {
    const accounts = await composio.connectedAccounts.list({ userIds: [USER_ID] });
    console.log(`Entity: ${USER_ID}\nConnected accounts:`);
    if (!accounts.items.length) console.log('  (none)');
    else for (const a of accounts.items) console.log(`  - ${a.toolkit?.slug ?? '?'} | ${a.status} | ${a.id}`);
    return;
  }

  if (cmd === 'reddit') return connectToolkit(composio, 'reddit', 'Reddit');
  if (cmd === 'sheets') return connectToolkit(composio, 'googlesheets', 'Google Sheets');

  console.error(`Unknown command: ${cmd}. Use: status | reddit | sheets`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
