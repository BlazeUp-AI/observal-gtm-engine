import type { RawLead } from '../types.js';

const ALGOLIA = 'https://hn.algolia.com/api/v1';

const QUERIES = [
  '"LangGraph"',
  '"CrewAI"',
  '"AutoGen" agents',
  '"OpenAI Agents SDK"',
  '"Bedrock Agents"',
  'agentic hiring',
  'AI agents production',
];

/**
 * HN via Algolia (no auth, generous limits).
 * Two passes: (1) recent stories/comments matching agent-stack queries,
 * (2) comments inside the latest "Ask HN: Who is hiring?" thread.
 */
export async function fetchHnLeads(daysBack = 30): Promise<RawLead[]> {
  const since = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const leads = new Map<string, RawLead>();

  for (const q of QUERIES) {
    const url = `${ALGOLIA}/search_by_date?query=${encodeURIComponent(q)}&tags=(story,comment)&numericFilters=created_at_i>${since}&hitsPerPage=50`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = (await res.json()) as { hits: AlgoliaHit[] };
    for (const hit of data.hits) addHit(leads, hit);
  }

  // Latest "Who is hiring" thread — agent-stack mentions inside it are the highest-signal job posts.
  const whoRes = await fetch(`${ALGOLIA}/search_by_date?query="Ask HN: Who is hiring"&tags=story&hitsPerPage=1`);
  if (whoRes.ok) {
    const who = (await whoRes.json()) as { hits: AlgoliaHit[] };
    const threadId = who.hits[0]?.objectID;
    if (threadId) {
      const cRes = await fetch(`${ALGOLIA}/search?tags=comment,story_${threadId}&hitsPerPage=1000`);
      if (cRes.ok) {
        const comments = (await cRes.json()) as { hits: AlgoliaHit[] };
        const kw = /langgraph|crewai|autogen|agentic|ai agents|llm agents|openai agents/i;
        for (const hit of comments.hits) {
          if (kw.test(hit.comment_text ?? '')) addHit(leads, hit);
        }
      }
    }
  }

  return [...leads.values()];
}

interface AlgoliaHit {
  objectID: string;
  title?: string;
  story_title?: string;
  url?: string;
  comment_text?: string;
  story_text?: string;
  author?: string;
  created_at_i?: number;
}

function addHit(leads: Map<string, RawLead>, hit: AlgoliaHit) {
  const text = [hit.title ?? hit.story_title, hit.comment_text ?? hit.story_text]
    .filter(Boolean)
    .join(' — ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 2000);
  if (!text) return;
  const url = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  leads.set(url, { source: 'hn', url, text, author: hit.author, postedAt: hit.created_at_i });
}
