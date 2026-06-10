import express from 'express';
import { buildDossier } from './agents/dossier-builder/index.js';
import { draftCommunityReply } from './agents/copilot/index.js';
import { config } from './core/config.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Slack slash commands are form-encoded

app.get('/health', (_req, res) => res.json({ ok: true, dryRun: config.dryRun }));

// Product signup webhook (from observal or a PostHog action webhook)
app.post('/webhooks/signup', async (req, res) => {
  const { email, name, company } = req.body ?? {};
  if (!email) return res.status(400).json({ error: 'email required' });
  void buildDossier({ email, name, company });
  res.json({ ok: true });
});

// Slack slash command: /draft <pasted thread>
app.post('/slack/draft', async (req, res) => {
  const text: string = req.body?.text ?? '';
  if (!text.trim()) return res.json({ response_type: 'ephemeral', text: 'Paste a thread after /draft.' });
  const draft = await draftCommunityReply(text);
  res.json({ response_type: 'ephemeral', text: draft });
});

app.listen(config.port, () => console.log(`gtm-engine server on :${config.port}`));
