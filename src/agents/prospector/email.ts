import { verifyEmail } from '../../core/reacher.js';

/**
 * Email discovery without Clay — playbook §9.3 A2:
 *   1. public GitHub commit emails (wired in the github source, Phase 1b)
 *   2. pattern inference from name + domain
 *   3. Reacher verification gates everything: not 'safe' -> not sequenced.
 *
 * Returns a verified email or null. Never returns an unverified guess.
 */
export async function discoverEmail(opts: {
  name: string;
  domain: string;
  knownEmails?: string[]; // any known addresses at this domain, to pick the right pattern first
}): Promise<{ email: string; source: 'pattern' } | null> {
  const candidates = patternCandidates(opts.name, opts.domain, opts.knownEmails ?? []);
  for (const email of candidates) {
    const result = await verifyEmail(email);
    if (result === 'safe') return { email, source: 'pattern' };
    if (result === 'unknown') break; // verifier unreachable/blocked — don't burn through guesses blindly
  }
  return null;
}

export function patternCandidates(fullName: string, domain: string, knownEmails: string[]): string[] {
  const parts = fullName.toLowerCase().replace(/[^a-z\s-]/g, '').trim().split(/\s+/);
  if (parts.length === 0) return [];
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';

  const patterns = [
    last ? `${first}.${last}` : first, // first.last — most common in tech
    first, // first
    last ? `${first}${last}` : first, // firstlast
    last ? `${first[0]}${last}` : first, // flast
    last ? `${first}.${last[0]}` : first, // first.l
  ];

  // If we know an address at this domain, infer its pattern and try that shape first.
  const known = knownEmails.find((e) => e.endsWith(`@${domain}`));
  if (known && last) {
    const local = known.split('@')[0];
    if (local.includes('.')) patterns.unshift(`${first}.${last}`);
    else if (local.length <= 8) patterns.unshift(`${first[0]}${last}`);
  }

  return [...new Set(patterns)].map((p) => `${p}@${domain}`);
}
