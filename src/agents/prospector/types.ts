export interface RawLead {
  source: 'hn' | 'github' | 'jobspy' | 'blog';
  url: string;
  text: string; // title + snippet/body, trimmed
  author?: string;
  postedAt?: number; // unix seconds
  meta?: { repo?: string }; // github: the agent repo, for champion/commit-email discovery
}

export interface ExtractedAccount {
  company: string;
  domain: string | null;
  archetype: string;
  icpScore: number; // 0-100
  rationale: string;
  agentStackEvidence: string;
}
