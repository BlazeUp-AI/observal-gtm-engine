import { z } from 'zod';
import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { getComposio, ENTITY, isToolkitConnected } from '../../core/composio.js';
import { discordPost } from '../../core/discord.js';
import { completeJson } from '../../core/llm.js';

const relevanceSchema = z.object({
  relevance: z.number().min(0).max(100).describe('how strongly this is someone feeling agent-tracking/governance pain RIGHT NOW'),
  why: z.string().describe('one line'),
});

/**
 * Signal Scout — hourly. Playbook §9.3 A3 + §9.5 C1.
 * HN (Algolia, no auth) + Reddit (via Composio when connected) keyword scan ->
 * Gemini relevance score -> intent_feed + Slack #signals.
 * Hits jump the outreach queue for HUMAN same-day replies — the scout never replies.
 */
export async function runSignalScout(hoursBack = 24) {
  await audit('signal-scout', 'run.start', { hoursBack });
  const found: { source: 'hn' | 'reddit'; url: string; author: string; snippet: string; postedAt?: number }[] = [];

  // --- HN: comments + stories matching pain keywords ---
  const since = Math.floor(Date.now() / 1000) - hoursBack * 3600;
  for (const kw of config.icpKeywords) {
    try {
      const res = await fetch(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(`"${kw}"`)}&tags=(story,comment)&numericFilters=created_at_i>${since}&hitsPerPage=10`,
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { hits: { objectID: string; author?: string; title?: string; comment_text?: string; created_at_i?: number }[] };
      for (const hit of data.hits) {
        const snippet = (hit.title ?? hit.comment_text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600);
        if (snippet) found.push({ source: 'hn', url: `https://news.ycombinator.com/item?id=${hit.objectID}`, author: hit.author ?? '?', snippet, postedAt: hit.created_at_i });
      }
    } catch {
      /* single keyword failure is fine */
    }
  }

  // --- Reddit via Composio (r/AI_Agents, r/LangChain) — requires ACTIVE Composio Reddit connection ---
  let redditHits = 0;
  if (config.signalScout.redditEnabled) {
    const composio = getComposio();
    if (!composio) {
      await audit('signal-scout', 'reddit.skipped', { reason: 'COMPOSIO_API_KEY missing' });
    } else if (!(await isToolkitConnected('reddit'))) {
      await audit('signal-scout', 'reddit.skipped', { reason: 'Reddit not connected — run: npm run composio:reddit' });
    } else {
      const kw = new RegExp(config.icpKeywords.map((k) => k.replace(/\s+/g, '\\s+')).join('|'), 'i');
      for (const sub of config.signalScout.redditSubreddits) {
        try {
          const result = await composio.tools.execute('REDDIT_RETRIEVE_REDDIT_POST', {
            userId: ENTITY.system,
            arguments: { subreddit: sub, size: 25 },
          });
          const raw = result.data as {
            posts?: { title?: string; selftext?: string; permalink?: string; author?: string; created_utc?: number }[];
            posts_list?: { data?: { title?: string; selftext?: string; permalink?: string; author?: string; created_utc?: number } }[];
          };
          const posts =
            raw.posts ??
            raw.posts_list?.map((item) => item.data).filter((p): p is NonNullable<typeof p> => Boolean(p)) ?? [];
          for (const p of posts) {
            if (p.created_utc != null && p.created_utc < since) continue;
            const text = `${p.title ?? ''} ${p.selftext ?? ''}`;
            if (!kw.test(text)) continue;
            found.push({
              source: 'reddit',
              url: `https://reddit.com${p.permalink}`,
              author: p.author ?? '?',
              snippet: text.replace(/\s+/g, ' ').slice(0, 600),
              postedAt: p.created_utc,
            });
            redditHits++;
          }
        } catch (err) {
          await audit('signal-scout', 'reddit.failed', { sub, error: String(err).slice(0, 150) });
        }
      }
      await audit('signal-scout', 'reddit.scanned', { hits: redditHits, subs: config.signalScout.redditSubreddits });
    }
  }

  // --- Score + store new hits ---
  let stored = 0;
  for (const hit of found) {
    const exists = await db.query.intentFeed.findFirst({ where: (t, { eq }) => eq(t.url, hit.url) });
    if (exists) continue;

    let relevance = 50;
    let why = 'unscored';
    if (config.gemini.apiKey) {
      try {
        const out = await completeJson(
          'You spot people publicly experiencing AI-agent sprawl/governance pain (lost prompt versions, unknown agent inventory, audit anxiety). High = personal, current, specific pain. Low = vendor content, tutorials, generic discussion.',
          `${hit.source} post by ${hit.author}:\n${hit.snippet}`,
          relevanceSchema,
          { qa: true },
        );
        relevance = out.relevance;
        why = out.why;
      } catch {
        /* keep default */
      }
    }
    if (relevance < 60) continue;

    await db.insert(schema.intentFeed).values({ source: hit.source, url: hit.url, author: hit.author, snippet: hit.snippet, relevanceScore: relevance, postedAt: hit.postedAt }).onConflictDoNothing();
    stored++;
    await discordPost(config.discord.signals, `*Intent signal (${relevance})* — ${hit.source} u/${hit.author}\n> ${hit.snippet.slice(0, 250)}\n${hit.url}\n_${why}_ · reply personally, today.`).catch(() => {});
    void import('../../core/sheets.js').then(async ({ appendOutcomeRow, defaultOutcomeMeta }) => {
      const meta = await defaultOutcomeMeta();
      return appendOutcomeRow({
        ...meta,
        timestamp: new Date().toISOString(),
        outcome_type: 'intent_signal',
        summary: hit.snippet.slice(0, 200),
        entity: hit.author,
        company: '',
        channel: hit.source,
        url: hit.url,
        source: hit.source,
        relevance_score: String(relevance),
      });
    }).catch(() => {});
  }

  await audit('signal-scout', 'run.end', { scanned: found.length, stored });
}
