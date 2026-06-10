# gtm-engine

The system that executes the observal.io 20-day GTM playbook: **seven agents, one process, one SQLite database, every external action audited.** Companion docs live in the marketing-synthesis repo: `deliverables/observal-gtm-playbook.md` (strategy, §9 = automation spec) and `deliverables/gtm-engine-build-plan.md` (this codebase's plan).

Brains: **Gemini** (via Vercel AI SDK). Tool layer: **Composio** (Gmail, Slack, Reddit, X, GitHub, Sheets). Email verification: **Reacher** (self-hosted). Job scraping: **JobSpy** (Python sidecar).

## Agents

| Agent | Trigger | Status |
|---|---|---|
| Prospector | nightly 02:00 | built — HN + GitHub + JobSpy sources, Gemini ICP scoring |
| Outreach Engine | every 30 min, 08–17 | built — state machine, personalization, QA, dry-run verified |
| Signal Scout | hourly | built — HN live, Reddit pending Composio connection |
| Reply Triager | every 5 min | built — pending Gmail connection |
| Dossier Builder | signup webhook | built — pending Slack connection |
| Scorecard Reporter | daily 08:00 | built — PostHog wiring stubbed |
| Drafting Copilot | Slack `/draft` | built — pending Slack app |

## Setup

```powershell
npm install
copy .env.example .env     # fill GEMINI_API_KEY, COMPOSIO_API_KEY, ...
npm run db:generate ; npm run db:migrate
docker compose -f services/reacher/docker-compose.yml up -d

# JobSpy sidecar (one-time; Prospector skips it gracefully if missing)
python -m venv services/jobspy/.venv
services\jobspy\.venv\Scripts\pip install python-jobspy
npm run cli -- prospect run     # smoke test
npm run dev                     # scheduler
npm run server                  # webhooks + slash commands (separate terminal)
```

## Safety rails (non-negotiable)

- `DRY_RUN=true` is the default. Live sending requires `DRY_RUN=false` **and** unpaused inboxes.
- `npm run cli -- pause all` is the global kill switch.
- The suppression table is checked in code before every send, by every sender path.
- No code path posts to a community. The Copilot returns text for a human to post.
- Ramp caps (10/day/inbox, +5/day, ceiling 40) live in `src/core/config.ts` — raising them is a decision, not an edit.
