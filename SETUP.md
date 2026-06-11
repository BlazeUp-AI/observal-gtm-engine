# Setup — what to do from your side, step by step

The engine is feature-complete and runs in `DRY_RUN=true` today. Each section below unlocks one capability. Do them in order; after each one there's a verify step.

---

## 0. Clone & install (any machine / VPS)

```powershell
git clone https://github.com/BlazeUp-AI/observal-gtm-engine.git
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
5. **General Information** → set **Interactions Endpoint URL** to:

   ```
   https://gtm.useobserval.xyz/discord/interactions
   ```

   Discord requires **HTTPS** (plain `http://` is rejected). Caddy on the GCP VM terminates TLS automatically once DNS is live.

6. **DNS (Porkbun)** — add an A record on `useobserval.xyz`:

   | Host | Type | Answer |
   |------|------|--------|
   | `gtm` | A | `104.197.53.207` |

   Wait 2–10 min for propagation, then on the VM: `sudo systemctl restart caddy`. Caddy will fetch a Let's Encrypt cert and HTTPS will work.

7. Verify: `curl https://gtm.useobserval.xyz/health` → `{"ok":true,...}` then save the Interactions URL in Discord (verification ping succeeds).
6. Invite the app to your server: **Installation** → Guild Install link (no extra permissions needed; the command replies ephemerally).

---

## 3. Composio: Reddit connection (5 min)

The engine uses Composio only for **Reddit** (Signal Scout). Email is AgentMail; Discord is webhooks — neither goes through Composio.

1. Ensure `.env` has `COMPOSIO_API_KEY=ak_...` (from https://app.composio.dev → Settings).
2. Auth config for Reddit should already exist in your Composio project (`reddit-0xy1w4`).
3. Connect Reddit for entity **`gtm-engine`** (this exact string — hardcoded in `src/core/composio.ts`):

   ```powershell
   npm run composio:reddit
   ```

   Opens a Composio Connect link → log into Reddit → approve. When status is `ACTIVE`, Signal Scout can read r/AI_Agents and r/LangChain.

4. Check status any time:

   ```powershell
   npm run composio:status
   ```

**Verify:** `npm run cli -- scout run 48` — audit log should show `reddit.scanned` alongside HN (no `reddit.failed` entries).

### 3b. LinkedIn intent signals (JobSpy — no OAuth)

Signal Scout scans **LinkedIn job postings** (not social posts — Composio LinkedIn cannot search feeds). Uses the same JobSpy sidecar as the Prospector:

```powershell
cd services/jobspy
python -m venv .venv
.\.venv\Scripts\pip install python-jobspy   # or: .venv/bin/pip on Linux
```

Disable with `SIGNAL_SCOUT_LINKEDIN=false` in `.env`.

**Verify:** `npm run cli -- scout run 48` — audit log should show `linkedin.scanned`.

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

## 5. Cold-email domains + inboxes via AgentMail (~30 min + 14-day warmup clock)

This is the longest-lead-time item — start it first in real life. **Never send cold email from observal.io itself.** Lookalike domains in hand (e.g. `useobserval.xyz`, `joinobserval.xyz`, `tryobserval.xyz`, `getobservable.xyz` on Porkbun).

> Note: `.xyz` TLDs carry a deliverability handicap (spam filters distrust the cheapest TLDs). Authenticate properly, warm up slowly, and watch the bounce/spam alarms. If inbox placement disappoints, add a `.com`/`.io` lookalike.

### 5a. AgentMail plan + API key

1. Custom domains require the **Developer plan ($20/mo)** — upgrade at https://console.agentmail.to.
2. Create an API key in the console and put it in `.env`: `AGENTMAIL_API_KEY=am_...`

### 5b. Register each domain and set DNS on Porkbun

For each sending domain:

```powershell
npm run cli -- domain add useobserval.xyz
```

This registers the domain with AgentMail and prints the exact DNS records (MX, SPF, DKIM, DMARC). Add them in Porkbun: domain → **DNS Records**. Then check until everything shows verified:

```powershell
npm run cli -- domain status useobserval.xyz
```

Repeat for the other domains. AgentMail manages SPF/DKIM/DMARC — no manual record crafting needed.

Also set a registrar-level URL forward of each root domain → observal.io (Porkbun → domain → URL Forwarding), so prospects who type the domain land somewhere real.

### 5c. Provision the inboxes

One command per inbox — this creates the inbox in AgentMail **and** starts its ramp clock (10/day, +5/day, ceiling 40):

```powershell
npm run cli -- inbox add aryan@useobserval.xyz
npm run cli -- inbox add aryan@joinobserval.xyz
npm run cli -- inbox add aryan@tryobserval.xyz
npm run cli -- inbox add aryan@getobservable.xyz
```

No per-inbox OAuth — sending and reply-polling go through the AgentMail API key.

### 5d. Warm up (days 1–14) — automated

The **Warmup agent** handles this: every 2 hours it exchanges short, Gemini-written, human-looking threads between your own inboxes (and any `WARMUP_SEED_EMAILS` you add), replies to ~45% of them, and marks them read — the engagement pattern mailbox providers want to see from a trustworthy sender. Volume auto-scales with each inbox's age (3/day on day 1 up to 8/day).

Hard safety rails:

- Warmup recipients are structurally limited to your own inboxes + the seed allowlist — no prospect can ever receive warmup mail.
- Inboxes under 5 days old are **warmup-only**: the Outreach Engine refuses to pick them for cold email.
- Add 1–2 personal Gmail/Outlook addresses to `WARMUP_SEED_EMAILS` in `.env` and occasionally open/reply/"not spam" from them — engagement from major providers is the strongest signal.

Boost (optional but recommended): manually send a few real emails from each inbox in week 1 via the AgentMail console. Don't flip `DRY_RUN=false` before day ~5.

---

## 6. PostHog — activation metrics + GTM dashboard

**Project:** [Observal](https://us.posthog.com/project/464332) (org: **Observal**, id `464332`)  
**Dashboard:** [Observal GTM — 20-Day Playbook](https://us.posthog.com/project/464332/dashboard/1694728)

### 6a. gtm-engine daily digest (Scorecard agent)

1. PostHog → Settings → **Personal API keys** → Create key with **Query read** scope.
2. `.env`:
   ```
   POSTHOG_API_KEY=phx_...
   POSTHOG_PROJECT_ID=464332
   POSTHOG_HOST=https://us.posthog.com
   ```
3. Restart scheduler on the VM after updating.

The Scorecard agent queries activated workspaces (3+ distinct `agent_id` per `workspace_id` on `agent_registered`).

### 6b. observal.io product SDK (required for dashboard data)

Install PostHog in the observal app and capture these events:

| Event | When | Required properties |
|---|---|---|
| `user_signed_up` | Account created | `utm_source`, `utm_medium`, `utm_campaign`, `email` (hashed ok) |
| `agent_registered` | Agent saved to registry | `workspace_id`, `agent_id`, `agent_type` |
| `insights_viewed` | User opens fleet Insights | `workspace_id` |
| `invite_sent` | Teammate invite sent | `workspace_id`, `invite_channel` |
| `invite_accepted` | Invite accepted | `workspace_id` |

```javascript
posthog.init('phc_o4YHrfXkTxa67mMvGUCBa3C4bwGTDsUTcPuGME8MmLgT', {
  api_host: 'https://us.i.posthog.com',
});

posthog.capture('user_signed_up', { utm_source: 'outreach', utm_medium: 'email' });
posthog.capture('agent_registered', { workspace_id, agent_id, agent_type: 'support' });
```

Lifecycle cohorts (for re-engagement emails) are pre-created in PostHog — they populate once events flow.

### 6c. Signup → Dossier Builder webhook

Option A — direct from your backend on signup:

```
POST https://gtm.useobserval.xyz/webhooks/signup
{ "email": "new.user@company.com", "name": "New User", "company": "Acme" }
```

Option B — PostHog Workflow: trigger on `user_signed_up` → HTTP POST action to the URL above (same JSON body from event properties).

Add the webhook wherever observal.io processes signups.

### 6d. Google Sheets scorecard (Composio)

**Sheet:** [Observal GTM Scorecard](https://docs.google.com/spreadsheets/d/1khilsBPv1RVBxYyu5AE5HI_0toF2V-po97xHxHT86l4/edit)

The Scorecard agent appends one row per day to **Daily Scorecard** (metrics aligned with the PostHog dashboard) and streams individual events to **Outcomes** (signups, sends, replies, intent signals).

1. Share the sheet with the Google account you'll use for Composio (**Editor** access).
2. Create two tabs named **Daily Scorecard** and **Outcomes** (if missing).
3. Connect Google Sheets:

   ```powershell
   npm run composio:sheets
   ```

4. `.env` defaults already point at this sheet (`GOOGLE_SHEETS_ID=...`).

**Verify:** `npm run cli -- report now` — header row + today's metrics appear in the sheet.

**Schema version:** `SHEETS_SCHEMA_VERSION=3` in `src/core/sheets.ts`. When bumped, row 1 on both tabs is rewritten on the next sync.

#### Daily Scorecard columns (54)

| Group | Columns |
| --- | --- |
| Meta | `date`, `campaign_day`, `days_remaining`, `engine_mode` |
| Pace | `activated_total`, `activated_today`, `pace_target`, `gap_to_pace`, `on_pace`, `next_milestone_day`, `next_milestone_target` |
| Product | `signups_today/cumulative`, `signups_email/community/content/invite/organic_today`, `agents_registered_today`, `insights_viewed_today` |
| Viral loop | `invites_sent/accepted_today`, `invites_sent/accepted_cumulative`, `invite_accept_rate_pct`, `k_factor` |
| Pipeline | `accounts_total/qualified`, `contacts_total/verified/queued/in_sequence/replied/activated` |
| Email | `emails_sent_today/total`, `emails_bounced`, `bounce_rate_pct`, `replies_today/total`, `replies_positive/question/objection/ooo/unsubscribe`, `positive_reply_rate_pct` |
| Community | `intent_signals_today/cumulative`, `intent_signals_hn/reddit/linkedin_today` |
| Deliverability | `inboxes_active`, `inboxes_paused` |
| Links | `posthog_dashboard`, `scorecard_sheet` |

#### Outcomes columns (12)

`timestamp`, `date`, `campaign_day`, `outcome_type`, `summary`, `entity`, `company`, `channel`, `url`, `source`, `relevance_score`, `engine_mode`

#### Leads columns (16)

`added_at`, `lead_type` (account | contact), `company`, `domain`, `archetype`, `icp_score`, `account_status`, `contact_name`, `contact_title`, `contact_email`, `email_status`, `contact_status`, `source`, `source_url`, `signal_summary`, `poc`

The **Leads** tab gets one row per prospected account and one per discovered contact, appended automatically at the end of every Prospector run (watermark-based, no duplicates). `poc` defaults to **Aryan** (`LEADS_POC` env var to change). Manual sync: `npm run cli -- leads sync`.

**PostHog dashboard:** [Observal GTM — 20-Day Playbook](https://us.posthog.com/project/464332/dashboard/1694728) links to the same sheet in its header tile.

---

## 7. Go live — automatic (no manual VM flip)

Set once in `.env` on the VM (or locally):

```
AUTO_GO_LIVE=true
FULL_REVIEW_UNTIL=2026-06-30
DRY_RUN=true
```

Leave `DRY_RUN=true`. When **every active inbox** passes the warmup-only window (ramp day > 5), the engine automatically:

1. Sets `CAMPAIGN_START` to today's date
2. Ensures `FULL_REVIEW_UNTIL=2026-06-30` is in `.env`
3. Flips live mode (`DRY_RUN=false` in `.env` + persisted in SQLite)
4. Posts a `*GTM engine is LIVE*` message to `#gtm-daily`

The check runs on scheduler startup, hourly, and after each warmup cycle — **no SSH, no `systemctl restart`, no manual env edits**.

**Verify readiness:** `npm run cli -- go-live status`

**Force the check now:** `npm run cli -- go-live check`

**Verify live:** `curl https://gtm.useobserval.xyz/health` → `"dryRun": false` after go-live.

Manual override still works: set `DRY_RUN=false` in `.env` anytime to go live early (not recommended before warmup completes).

Watch `#gtm-daily` after go-live — bounce/spam alarms auto-pause sending at 3% bounce or 0.1% spam.

Kill switch any time: `npm run cli -- pause all`.

---

## Priority order (if you do one thing per day)

| Day | Task | Why first |
|---|---|---|
| 1 | 5a+5b: AgentMail plan, register domains, Porkbun DNS | 14-day warmup clock starts ticking |
| 1 | Step 1: GitHub token | 5 minutes, unlocks contact discovery |
| 2 | Step 2: Discord channels + webhooks | makes all agents visible |
| 2 | Step 4: Reacher | unlocks email verification |
| 3 | Step 3: Composio Reddit | unlocks full Signal Scout |
| 3 | 5c: provision inboxes | engine starts dry-run planning real sends |
| 5+ | Steps 6–8 | metrics, dossiers, go-live |
