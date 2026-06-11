import { fetchJobspyLeads } from '../../prospector/sources/jobspy.js';

export type LinkedInSignal = {
  source: 'linkedin';
  url: string;
  author: string;
  snippet: string;
  postedAt?: number;
};

/**
 * LinkedIn hiring-intent signals via JobSpy (LinkedIn job posts only).
 * Composio's LinkedIn toolkit cannot search posts — job postings are the
 * reliable public signal for companies actively building agent stacks.
 */
export async function fetchLinkedInJobSignals(hoursBack: number): Promise<LinkedInSignal[]> {
  const leads = await fetchJobspyLeads({ sites: ['linkedin'], hoursOld: Math.max(hoursBack, 1) });
  return leads
    .filter((l) => l.url.includes('linkedin.com'))
    .map((l) => ({
      source: 'linkedin' as const,
      url: l.url,
      author: l.company ?? l.author ?? 'unknown',
      snippet: l.text.replace(/\s+/g, ' ').slice(0, 600),
      postedAt: l.postedAt,
    }));
}
