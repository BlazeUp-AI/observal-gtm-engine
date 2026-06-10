import express from 'express';
import { verifyKeyMiddleware, InteractionType, InteractionResponseType } from 'discord-interactions';
import { buildDossier } from './agents/dossier-builder/index.js';
import { draftCommunityReply } from './agents/copilot/index.js';
import { config } from './core/config.js';

const app = express();

// Discord interactions need the raw body for ed25519 verification —
// this route MUST be registered before express.json().
app.post(
  '/discord/interactions',
  verifyKeyMiddleware(config.discord.publicKey),
  (req, res) => {
    const interaction = req.body;

    if (interaction.type === InteractionType.PING) {
      return res.json({ type: InteractionResponseType.PONG });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data?.name === 'draft') {
      const thread: string =
        interaction.data.options?.find((o: { name: string }) => o.name === 'thread')?.value ?? '';
      const venue: string | undefined =
        interaction.data.options?.find((o: { name: string }) => o.name === 'venue')?.value;

      // Ack within 3s (ephemeral), then edit the response once Gemini is done.
      res.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });

      void (async () => {
        const content = thread.trim()
          ? (await draftCommunityReply(thread, venue)).slice(0, 2000)
          : 'Paste the community thread into the `thread` option.';
        await fetch(
          `https://discord.com/api/v10/webhooks/${config.discord.appId}/${interaction.token}/messages/@original`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content }),
          },
        ).catch((err) => console.error('[discord] follow-up failed:', err));
      })();
      return;
    }

    return res.status(400).json({ error: 'unhandled interaction' });
  },
);

app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, dryRun: config.dryRun }));

// Product signup webhook (from observal or a PostHog action webhook)
app.post('/webhooks/signup', async (req, res) => {
  const { email, name, company } = req.body ?? {};
  if (!email) return res.status(400).json({ error: 'email required' });
  void buildDossier({ email, name, company });
  res.json({ ok: true });
});

// Plain HTTP fallback for the copilot (curl / internal tools), no Discord required
app.post('/draft', async (req, res) => {
  const { text, venue } = req.body ?? {};
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  res.json({ draft: await draftCommunityReply(text, venue) });
});

app.listen(config.port, () => console.log(`gtm-engine server on :${config.port}`));
