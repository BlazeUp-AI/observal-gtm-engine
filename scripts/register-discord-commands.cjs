// One-off: registers the /draft slash command with Discord.
// Usage: node scripts/register-discord-commands.cjs   (needs DISCORD_APP_ID + DISCORD_BOT_TOKEN in .env)
require('dotenv').config();

const appId = process.env.DISCORD_APP_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (!appId || !token) {
  console.error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN in .env first.');
  process.exit(1);
}

const commands = [
  {
    name: 'draft',
    description: 'Draft a give-first community reply in the observal voice (never auto-posts)',
    options: [
      { type: 3, name: 'thread', description: 'Paste the community thread/question', required: true },
      { type: 3, name: 'venue', description: 'hn | reddit | discord | slack (optional)', required: false },
    ],
  },
];

fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', authorization: `Bot ${token}` },
  body: JSON.stringify(commands),
})
  .then(async (res) => {
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    console.log('Registered /draft globally (may take up to an hour to appear).');
  })
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
