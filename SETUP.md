# Setup — what to do from your side, step by step

The engine is feature-complete and runs in `DRY_RUN=true` today. Each section below unlocks one capability. Do them in order; after each one there's a verify step.

---

## 0. Clone & install (any machine / VPS)

```powershell
git clone https://github.com/aryaniyaps/observal-gtm-engine.git
cd observal-gtm-engine
npm install
copy .env.example .env
npm run db:generate ; npm run db:migrate
```

Put your existing keys in `.env`:

```
GEMINI_API_KEY=...        # you already have this
COMPOSIO_API_KEY=...      # you already have this
```

**Verify:** `npm run cli -- prospect run` — should pull HN leads and score them with Gemini.

---

## 1. GitHub token (5 min) — unlocks GitHub prospecting + champion discovery

1. Go to https://github.com/settings/tokens → **Generate new token (classic)**.
2. Name it `gtm-engine`, expiry 90 days, scope: only **`public_repo`** (read public repos). No other scopes.
3. Copy the token into `.env`:
   ```
   GITHUB_TOKEN=ghp_...
   ```

**Verify:** `npm run cli -- prospect run` — audit log should show `source.github` with a count > 0, and qualified GitHub accounts should get contacts mined from commit emails.

---

## 2. Discord server + channels (15 min) — unlocks all agent notifications

### 2a. Create the channels

In your Discord server create four text channels:

| Channel | Used by |
|---|---|
| `#gtm-signals` | Signal Scout posts buying-intent threads from HN/Reddit |
| `#gtm-replies` | Reply Triager posts classified replies + suggested drafts |
| `#gtm-new-signups` | Dossier Builder posts a dossier when someone signs up |
| `#gtm-daily` | Scorecard Reporter posts the daily digest at 08:00 |

### 2b. Create a webhook per channel

For each channel: gear icon (**Edit Channel**) → **Integrations** → **Webhooks** → **New Webhook** → name it `gtm-engine` → **Copy Webhook URL**. Put the four URLs in `.env`:

```
DISCORD_WEBHOOK_SIGNALS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_REPLIES=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_NEW_SIGNUPS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_GTM_DAILY=https://discord.com/api/webhooks/...
```

That's it for notifications — webhooks need no bot, no OAuth, no Composio.

**Verify:** `npm run cli -- report now` — the daily digest should appear in `#gtm-daily`.

### 2c. (Optional, for the Drafting Copilot) `/draft` slash command

Needs the server publicly reachable (do this once deployed on the VPS):

1. https://discord.com/developers/applications → **New Application** → name it `gtm-copilot`.
2. From **General Information** copy **Application ID** and **Public Key** into `.env` (`DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`).
3. **Bot** tab → **Reset Token** → copy into `.env` as `DISCORD_BOT_TOKEN`.
4. Register the command: `node scripts/register-discord-commands.cjs`
5. **General Information** → set **Interactions Endpoint URL** to `https://<your-server>/discord/interactions` (the server must be running — Discord sends a verification ping).
6. Invite the app to your server: **Installation** → Guild Install link (no extra permissions needed; the command replies ephemerally).

---

## 3. Composio: Reddit + Gmail connections (15 min)

In https://app.composio.dev → **Apps**:

1. **Reddit** → Connect (entity `gtm-engine`). Unlocks Signal Scout's Reddit search (r/LangChain, r/LocalLLaMA, etc.).
2. **Gmail** → you'll connect this *per sending inbox* in step 5 — skip for now.

**Verify Reddit:** `npm run cli -- scout run 48` — audit log should show Reddit results alongside HN.

---

## 4. Reacher email verifier (10 min, needs Docker)

1. Install Docker Desktop (or Docker on the VPS).
2. From the repo root:
   ```powershell
   docker compose -f services/reacher/docker-compose.yml up -d
   ```
3. `.env` already points at it: `REACHER_URL=http://localhost:8080`.

**Verify:** `curl -X POST http://localhost:8080/v0/check_email -H "content-type: application/json" -d '{\"to_email\":\"test@gmail.com\"}'` returns JSON with `is_reachable`.

Without Reacher, contacts stay `unverified` and the Outreach Engine refuses to sequence them — this is the main thing blocking contacts today.

---

## 5. Cold-email domains + inboxes (1–2 hours + 14-day warmup clock)

This is the longest-lead-time item — start it first in real life.

### 5a. Buy 3 lookalike domains

E.g. if your product is `observal.io`, buy `observalhq.com`, `getobserval.com`, `tryobserval.com` (Namecheap/Cloudflare, ~$30 total). **Never send cold email from observal.io itself.**

### 5b. Google Workspace

1. Create a Google Workspace account (Business Starter, ~$7/user/mo) per domain — 4 inboxes total spread across the 3 domains (e.g. `aryan@observalhq.com`, `aryan@getobserval.com`, `team@getobserval.com`, `aryan@tryobserval.com`).
2. For each domain, in your DNS provider set:
   - **MX** records (Google gives you the values during setup)
   - **SPF**: TXT `v=spf1 include:_spf.google.com ~all`
   - **DKIM**: Admin console → Apps → Google Workspace → Gmail → Authenticate email → generate, then add the TXT record
   - **DMARC**: TXT at `_dmarc.<domain>`: `v=DMARC1; p=quarantine; rua=mailto:you@yourdomain.com`
3. Enroll every domain in **Google Postmaster Tools** (https://postmaster.google.com) — this is where the spam-rate alarm reads from.
4. On each domain, set up a redirect of the root domain → observal.io (registrar-level forward is fine).

### 5c. Connect each inbox via Composio Gmail

For **each** of the 4 inboxes: in Composio → Gmail → Connect, and authorize while logged into that inbox. Use entity id `inbox:<email>` (e.g. `inbox:aryan@observalhq.com`) — that's how the sender code routes.

### 5d. Register the inboxes with the engine

```powershell
npm run cli -- inbox add aryan@observalhq.com
npm run cli -- inbox add aryan@getobserval.com
npm run cli -- inbox add team@getobserval.com
npm run cli -- inbox add aryan@tryobserval.com
```

This starts each inbox's ramp clock (10/day, +5/day, ceiling 40).

### 5e. Warm up (days 1–14)

Send 5–10 *manual, real* emails per inbox per day for the first week (to colleagues, friends, your own accounts — and reply to them). The engine's ramp caps handle the rest. Don't flip `DRY_RUN=false` before day ~5.

---

## 6. PostHog (optional, 10 min) — activation metrics in the daily digest

1. PostHog → Settings → **Personal API key** (read scope on your project).
2. `.env`:
   ```
   POSTHOG_API_KEY=phx_...
   POSTHOG_PROJECT_ID=12345
   POSTHOG_HOST=https://us.posthog.com
   ```

---

## 7. Signup webhook — unlocks the Dossier Builder

Point your product's signup event at the engine:

```
POST http://<your-server>:3000/webhooks/signup
Content-Type: application/json

{ "email": "new.user@company.com", "name": "New User" }
```

Add it wherever observal.io processes signups (backend hook, or a PostHog/Zapier-style webhook on the signup event).

---

## 8. Go live checklist

Only after steps 1–5 are done and inboxes are ≥5 days into warmup:

1. `FULL_REVIEW_UNTIL=2026-06-30` in `.env` (every email gets human review until that date, 10% sampling after).
2. Flip `DRY_RUN=false`.
3. Start the engine on the VPS:
   ```powershell
   npm run dev      # scheduler (all 7 agents on cron)
   npm run server   # webhooks + /draft (second process)
   ```
4. Watch `#gtm-daily` — the digest includes bounce/spam alarms that auto-pause sending at 3% bounce or 0.1% spam.
5. Kill switch any time: `npm run cli -- pause all`.

---

## Priority order (if you do one thing per day)

| Day | Task | Why first |
|---|---|---|
| 1 | 5a+5b: buy domains, create inboxes, DNS | 14-day warmup clock starts ticking |
| 1 | Step 1: GitHub token | 5 minutes, unlocks contact discovery |
| 2 | Step 2: Discord channels + webhooks | makes all agents visible |
| 2 | Step 4: Reacher | unlocks email verification |
| 3 | Step 3: Composio Reddit | unlocks full Signal Scout |
| 3 | 5c+5d: connect + register inboxes | engine starts dry-run planning real sends |
| 5+ | Steps 6–8 | metrics, dossiers, go-live |
