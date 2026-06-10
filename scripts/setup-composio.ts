/**
 * One-shot Composio setup for gtm-engine entity connections.
 * Usage: npx tsx scripts/setup-composio.ts [reddit|status]
 */
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { ENTITY } from '../src/core/composio.js';

const USER_ID = ENTITY.system; // gtm-engine

async function main() {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.error('Set COMPOSIO_API_KEY in .env first.');
    process.exit(1);
  }

  const composio = new Composio({ apiKey, provider: new VercelProvider() });
  const cmd = process.argv[2] ?? 'status';

  if (cmd === 'status') {
    const accounts = await composio.connectedAccounts.list({ userIds: [USER_ID] });
    const configs = await composio.authConfigs.list();
    console.log(`Entity: ${USER_ID}`);
    console.log('\nConnected accounts:');
    if (!accounts.items.length) {
      console.log('  (none)');
    } else {
      for (const a of accounts.items) {
        console.log(`  - ${a.toolkit?.slug ?? '?'} | ${a.status} | ${a.id}`);
      }
    }
    console.log('\nAuth configs:');
    for (const c of configs.items) {
      console.log(`  - ${c.toolkit.slug} | ${c.id} | connections=${c.noOfConnections}`);
    }
    return;
  }

  if (cmd === 'reddit') {
    const configs = await composio.authConfigs.list({ toolkitSlugs: ['reddit'] });
    const reddit = configs.items[0];
    if (!reddit) {
      console.error('No Reddit auth config found. Create one at https://app.composio.dev first.');
      process.exit(1);
    }

    const existing = await composio.connectedAccounts.list({
      userIds: [USER_ID],
      toolkitSlugs: ['reddit'],
    });
    const active = existing.items.find((a) => a.status === 'ACTIVE');
    if (active) {
      console.log(`Reddit already connected: ${active.id}`);
      return;
    }

    const req = await composio.connectedAccounts.link(USER_ID, reddit.id, {
      callbackUrl: 'https://gtm.useobserval.xyz/health',
    });
    console.log('\nOpen this URL to connect Reddit for Signal Scout:\n');
    console.log(req.redirectUrl);
    console.log('\nWaiting for connection (up to 5 min)...');
    const connected = await req.waitForConnection(300_000);
    console.log(`Connected: ${connected.id} (${connected.status})`);
    return;
  }

  console.error(`Unknown command: ${cmd}. Use: status | reddit`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
