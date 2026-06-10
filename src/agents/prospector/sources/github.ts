import type { RawLead } from '../types.js';

/**
 * GitHub source — orgs with agent frameworks in dependency manifests, plus
 * public commit emails for champion discovery (playbook §9.3 A2 path 1).
 * Needs GITHUB_TOKEN (free PAT, 30 code-search req/min) — skips cleanly without it.
 */
const SEARCHES = [
  '"langgraph" in:file filename:requirements.txt',
  '"langgraph" in:file filename:pyproject.toml',
  '"crewai" in:file filename:requirements.txt',
  '"@openai/agents" in:file filename:package.json',
  '"autogen-agentchat" in:file filename:requirements.txt',
];

const API = 'https://api.github.com';

function headers(token: string) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'gtm-engine-prospector',
  };
}

export async function fetchGithubLeads(token: string): Promise<RawLead[]> {
  const orgs = new Map<string, { repo: string; manifest: string }>();

  for (const q of SEARCHES) {
    const res = await fetch(`${API}/search/code?q=${encodeURIComponent(q)}&per_page=30`, {
      headers: headers(token),
    });
    if (res.status === 403 || res.status === 429) break; // rate limited — take what we have
    if (!res.ok) continue;
    const data = (await res.json()) as {
      items: { repository: { full_name: string; owner: { login: string; type: string } }; path: string }[];
    };
    for (const item of data.items) {
      // Organizations only — personal repos are hobby noise for this ICP.
      if (item.repository.owner.type !== 'Organization') continue;
      const org = item.repository.owner.login;
      if (!orgs.has(org)) orgs.set(org, { repo: item.repository.full_name, manifest: item.path });
    }
    await sleep(2500); // stay under code-search rate limits
  }

  const leads: RawLead[] = [];
  for (const [org, info] of orgs) {
    leads.push({
      source: 'github',
      url: `https://github.com/${org}`,
      text: `GitHub org "${org}" has agent-framework dependencies in ${info.repo} (${info.manifest}). Evidence of agents in active development.`,
      meta: { repo: info.repo },
    });
  }
  return leads;
}

/**
 * Public commit emails for an org's agent-related repo — the classic dev-tool
 * growth move. Returns deduped {name, email, commits} excluding noreply/bot addresses.
 * EU guardrail (playbook §9.11) is enforced by the caller via contacts.region.
 */
export async function fetchCommitAuthors(
  token: string,
  repoFullName: string,
): Promise<{ name: string; email: string; commits: number }[]> {
  const res = await fetch(`${API}/repos/${repoFullName}/commits?per_page=100`, { headers: headers(token) });
  if (!res.ok) return [];
  const commits = (await res.json()) as { commit: { author: { name?: string; email?: string } } }[];

  const authors = new Map<string, { name: string; email: string; commits: number }>();
  for (const c of commits) {
    const { name, email } = c.commit.author ?? {};
    if (!name || !email) continue;
    if (/noreply|no-reply|\[bot\]|users\.noreply\.github\.com|actions@github\.com/i.test(email)) continue;
    const entry = authors.get(email) ?? { name, email, commits: 0 };
    entry.commits++;
    authors.set(email, entry);
  }
  return [...authors.values()].sort((a, b) => b.commits - a.commits);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
