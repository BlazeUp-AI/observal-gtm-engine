import { config } from './config.js';

/**
 * Discord notification layer. Channel posts use plain channel webhooks — no bot
 * token, no OAuth, no Composio scopes. One webhook URL per channel in .env.
 */

const MAX_LEN = 2000; // Discord hard limit per message

/** Slack-style *bold* -> Discord **bold** (agents write mrkdwn-ish text). */
function toDiscordMarkdown(text: string): string {
  return text.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '**$1**');
}

function chunk(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_LEN) {
    let cut = rest.lastIndexOf('\n', MAX_LEN);
    if (cut < MAX_LEN / 2) cut = MAX_LEN;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}

/** Post to a Discord channel webhook. Soft-fails with a console note when unconfigured. */
export async function discordPost(webhookUrl: string, text: string) {
  if (!webhookUrl) {
    console.log(`[discord:skipped — no webhook configured] ${text.slice(0, 200)}`);
    return;
  }
  for (const part of chunk(toDiscordMarkdown(text))) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: part, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) throw new Error(`discord webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
