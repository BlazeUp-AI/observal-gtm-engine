# gtm-engine

The system that executes the observal.io 20-day GTM playbook: **seven agents, one process, one SQLite database, every external action audited.** Companion docs live in the marketing-synthesis repo: `deliverables/observal-gtm-playbook.md` (strategy, §9 = automation spec) and `deliverables/gtm-engine-build-plan.md` (this codebase's plan).

Brains: **Gemini** (via Vercel AI SDK). Email: **AgentMail** (API inboxes on cold-email domains, send/receive, managed SPF/DKIM/DMARC). Tool layer: **Composio** (Reddit, X, GitHub, Sheets). Notifications: **Discord** (plain channel webhooks). Email verification: **Reacher** (self-hosted). Job scraping: **JobSpy** (Python sidecar).

## Agents

| Agent | Trigger | Status |
|---|---|---|
| Prospector | nightly 02:00 | built — HN + GitHub + JobSpy sources, Gemini ICP scoring |
| Outreach Engine | every 30 min, 08–17 | built — state machine, personalization, QA, dry-run verified |
| Signal Scout | hourly | built — HN live + Reddit via Composio when connected |
| Reply Triager | every 5 min | built — polls AgentMail inboxes |
| Dossier Builder | signup webhook | built — pending Discord webhook |
| Scorecard Reporter | daily 08:00 | built — PostHog wiring stubbed |
| Drafting Copilot | Discord `/draft` | built — pending Discord app |
| Warmup | every 2h, 08–18 | built — own-inbox + seed traffic only, runs even in DRY_RUN |

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

- `DRY_RUN=true` is the default. With `AUTO_GO_LIVE=true`, the engine flips live automatically once every active inbox passes the 5-day warmup window — no manual SSH.
- Manual early go-live: set `DRY_RUN=false` in `.env` (not recommended before warmup completes).
- `npm run cli -- pause all` is the global kill switch.
- The suppression table is checked in code before every send, by every sender path.
- No code path posts to a community. The Copilot returns text for a human to post.
- Ramp caps (10/day/inbox, +5/day, ceiling 40) live in `src/core/config.ts` — raising them is a decision, not an edit.
- Inboxes younger than 5 days are warmup-only: the outreach engine will not pick them for cold sends.
- The Warmup agent's recipient set is structurally limited to our own inboxes + `WARMUP_SEED_EMAILS` — a prospect address cannot enter that code path.
