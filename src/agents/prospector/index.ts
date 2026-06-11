import { eq } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { discordPost } from '../../core/discord.js';
import { syncLeadsToSheet } from '../../core/sheets.js';
import { fetchHnLeads } from './sources/hn.js';
import { fetchGithubLeads } from './sources/github.js';
import { fetchJobspyLeads } from './sources/jobspy.js';
import { findChampionsForGithubAccount } from './champion.js';
import { extractAndScore } from './score.js';
import type { RawLead } from './types.js';

/**
 * Prospector — nightly. Playbook §9.3 (A1/A2).
 * sources -> ICP scoring -> upsert accounts -> (Phase 1b: champion + email discovery).
 *
 * Implemented: HN Algolia source, Gemini extraction + ICP scoring, account upsert, Slack summary.
 * Next (Phase 1b): sources/github.ts (orgs + commit emails), services/jobspy sidecar,
 * champion identification, email discovery wiring (email.ts is ready and Reacher-gated).
 */
export async function runProspector() {
  await audit('prospector', 'run.start');

  const leads: RawLead[] = [];
  try {
    const hn = await fetchHnLeads();
    leads.push(...hn);
    await audit('prospector', 'source.hn', { count: hn.length });
  } catch (err) {
    await audit('prospector', 'source.hn.failed', { error: String(err) });
  }

  if (config.githubToken) {
    try {
      const gh = await fetchGithubLeads(config.githubToken);
      leads.push(...gh);
      await audit('prospector', 'source.github', { count: gh.length });
    } catch (err) {
      await audit('prospector', 'source.github.failed', { error: String(err) });
    }
  } else {
    await audit('prospector', 'source.github.skipped', { note: 'GITHUB_TOKEN missing' });
  }

  try {
    const js = await fetchJobspyLeads();
    leads.push(...js);
    await audit('prospector', 'source.jobspy', { count: js.length });
  } catch (err) {
    await audit('prospector', 'source.jobspy.failed', { error: String(err) });
  }

  if (!config.gemini.apiKey) {
    await audit('prospector', 'run.end', {
      note: `scoring skipped — GEMINI_API_KEY missing; ${leads.length} raw leads fetched and discarded`,
    });
    return;
  }

  let scored = 0;
  let qualified = 0;
  for (const lead of leads) {
    try {
      const account = await extractAndScore(lead);
      scored++;
      if (!account || account.icpScore < 40) continue;
      qualified++;

      const domain = account.domain ?? `unknown:${account.company.toLowerCase().replace(/\s+/g, '-')}`;
      const existing = await db.query.accounts.findFirst({ where: eq(schema.accounts.domain, domain) });
      const sourceEntry = { type: lead.source, url: lead.url, snippet: account.agentStackEvidence };

      if (existing) {
        const sources = JSON.parse(existing.sourcesJson ?? '[]') as unknown[];
        if (!sources.some((s) => (s as { url?: string }).url === lead.url)) sources.push(sourceEntry);
        await db
          .update(schema.accounts)
          .set({
            icpScore: Math.max(existing.icpScore ?? 0, account.icpScore),
            sourcesJson: JSON.stringify(sources),
          })
          .where(eq(schema.accounts.id, existing.id));
      } else {
        const inserted = await db
          .insert(schema.accounts)
          .values({
            domain,
            name: account.company,
            archetype: account.archetype,
            icpScore: account.icpScore,
            scoreRationale: account.rationale,
            sourcesJson: JSON.stringify([sourceEntry]),
            status: account.icpScore >= 70 ? 'qualified' : 'new',
          })
          .returning({ id: schema.accounts.id });
        // GitHub-sourced + qualified -> mine the agent repo's committers for champions
        if (lead.source === 'github' && lead.meta?.repo && account.icpScore >= 70) {
          await findChampionsForGithubAccount(inserted[0].id, lead.meta.repo).catch(async (err) => {
            await audit('prospector', 'champion.failed', { repo: lead.meta?.repo, error: String(err) });
          });
        }
      }
    } catch (err) {
      await audit('prospector', 'score.failed', { url: lead.url, error: String(err) });
    }
  }

  // Live lead visibility — push newly created accounts/contacts to the Leads tab.
  try {
    await syncLeadsToSheet();
  } catch (err) {
    await audit('prospector', 'leads.sync.failed', { error: String(err).slice(0, 200) });
  }

  const summary = `Prospector: ${leads.length} leads fetched, ${scored} scored, ${qualified} qualified (≥40). High-priority (≥70) accounts are status=qualified.`;
  await audit('prospector', 'run.end', { leads: leads.length, scored, qualified });
  await discordPost(config.discord.signals, summary).catch(() => {});
}
