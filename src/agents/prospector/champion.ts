import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { config } from '../../core/config.js';
import { verifyEmail } from '../../core/reacher.js';
import { fetchCommitAuthors } from './sources/github.js';

/**
 * Champion identification — playbook §9.3 A2.
 * GitHub-sourced accounts: top committers on the agent repo ARE the champions,
 * and their commit emails are discovery path #1. Verified via Reacher before
 * they can ever be sequenced; 'unverified' contacts sit in the manual-review lane.
 */
export async function findChampionsForGithubAccount(accountId: number, repoFullName: string) {
  if (!config.githubToken) return;

  const authors = await fetchCommitAuthors(config.githubToken, repoFullName);
  const top = authors.slice(0, 2); // the people who actually build the agents

  for (const author of top) {
    const existing = await db.query.contacts.findFirst({
      where: and(eq(schema.contacts.accountId, accountId), eq(schema.contacts.email, author.email)),
    });
    if (existing) continue;

    let emailStatus: 'verified' | 'unverified' | 'dropped' = 'unverified';
    try {
      const result = await verifyEmail(author.email);
      emailStatus = result === 'safe' ? 'verified' : result === 'invalid' ? 'dropped' : 'unverified';
    } catch {
      // Reacher not reachable — leave unverified; sequencing requires 'verified'.
    }

    await db.insert(schema.contacts).values({
      accountId,
      name: author.name,
      email: author.email,
      emailStatus,
      emailSource: 'commit',
      signalUrl: `https://github.com/${repoFullName}`,
      signalSummary: `Top committer (${author.commits} recent commits) on agent repo ${repoFullName}`,
      status: 'new',
    });
    await audit('prospector', 'champion.found', {
      accountId,
      name: author.name,
      emailStatus,
      repo: repoFullName,
    });
  }
}
