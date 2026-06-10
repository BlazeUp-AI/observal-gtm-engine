/**
 * The three archetype variants from the playbook §4 — verbatim structure,
 * {{opener}} is generated per-contact from their captured signal.
 * Under 100 words, one CTA (free tier), no images, no tracking.
 */
export interface Variant {
  id: 'A' | 'B' | 'C';
  subject: string;
  body: (opener: string, link: string) => string;
  followUp3: (link: string) => string;
  followUp7: (templateLink: string) => string;
}

export function variantForArchetype(archetype: string | null): Variant {
  if (archetype === 'agency') return VARIANT_C;
  if (archetype === 'fintech' || archetype === 'regulated') return VARIANT_B;
  return VARIANT_A;
}

export const VARIANT_A: Variant = {
  id: 'A',
  subject: 'which prompt is live?',
  body: (opener, link) =>
    `${opener}

Honest question: when someone changes a prompt, where does the old version go? Every team I talk to says "git, sort of, plus a Notion page nobody updates."

We built observal as a system of record for agents — registry, versioning, diffs. Free tier covers 5 agents and your whole team, no card.

Worth 15 minutes to register your agents? → ${link}`,
  followUp3: (link) =>
    `One more data point and then I'll leave you alone: teams usually find 2-3 agents they'd forgotten about when they first fill the registry. The forgotten ones are the risky ones.

${link} — 15 min, free tier.`,
  followUp7: (templateLink) =>
    `Closing the loop — if a tool isn't the right move yet, here's the spreadsheet template we give everyone for tracking agents manually: ${templateLink}

No signup. If the spreadsheet starts hurting, you know where we are.`,
};

export const VARIANT_B: Variant = {
  id: 'B',
  subject: '"what did the agent decide?"',
  body: (opener, link) =>
    `${opener}

You're probably ~6 weeks from compliance asking "which agents touch customer data, and what changed last month?"

Right now, can you answer that without grepping three repos?

observal gives you one registry of every agent — what it knows, does, and decides — versioned. Free for 5 agents, 20 users.

Set it up before the question gets asked: ${link}`,
  followUp3: (link) =>
    `Quick addition: the audit-trail question usually arrives via legal, not engineering — which means it arrives with a deadline.

A registry you set up this week answers it in one link: ${link}`,
  followUp7: (templateLink) =>
    `Last note from me — manual fallback if tooling isn't on the table yet: our agent-tracking template covers owner, data access, and version history columns: ${templateLink}

Free, no signup. Good luck with the agents.`,
};

export const VARIANT_C: Variant = {
  id: 'C',
  subject: 'agent handoffs to clients',
  body: (opener, link) =>
    `${opener}

Curious how handoff works: when the client asks "what exactly is this agent configured to do?" six months later, what do you send them?

Agencies use observal as the deliverable — a living registry of every agent's config, versions, and behavior. Beats a stale Google Doc.

Free tier per workspace: ${link}. Takes one engagement to try.`,
  followUp3: (link) =>
    `One angle worth stealing even if you never use us: agencies that hand off a registry instead of a doc get fewer "what does this agent do again?" support pings months later.

Free workspace per client: ${link}`,
  followUp7: (templateLink) =>
    `Closing out — here's the agent-documentation template we share freely, works as a client deliverable as-is: ${templateLink}

If you'd rather it be alive and versioned, the free tier exists. Either way, good luck.`,
};
