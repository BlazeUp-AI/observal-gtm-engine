import 'dotenv/config';
import { discordPost } from '../src/core/discord.ts';

const channels = [
  ['DISCORD_WEBHOOK_SIGNALS', '#gtm-signals — Signal Scout will post buying-intent threads here.'],
  ['DISCORD_WEBHOOK_REPLIES', '#gtm-replies — Reply Triager will post classified replies + drafts here.'],
  ['DISCORD_WEBHOOK_NEW_SIGNUPS', '#gtm-new-signups — Dossier Builder will post signup dossiers here.'],
  ['DISCORD_WEBHOOK_GTM_DAILY', '#gtm-daily — Scorecard Reporter will post the daily digest here at 08:00.'],
];

for (const [key, msg] of channels) {
  try {
    await discordPost(process.env[key] ?? '', `*Webhook test OK* — ${msg}`);
    console.log(`${key}: OK`);
  } catch (err) {
    console.log(`${key}: FAILED — ${err.message}`);
  }
}
