import { db, schema } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { complete } from '../../core/llm.js';

/**
 * Drafting Copilot — Slack `/draft`. Playbook §9.5 C2.
 * Give-first community drafts in our voice. Returns text only — there is
 * intentionally no code path that posts to a community.
 */
const VOICE = `You draft replies for community threads (LangChain Slack, CrewAI Discord, MLOps Slack,
r/AI_Agents, Hacker News) on behalf of an observal.io founder.

Non-negotiable rules (from "Developer Marketing Does Not Exist" — authenticity or nothing):
1. ANSWER THE QUESTION COMPLETELY FIRST, manually, as a peer engineer would. The reader should
   get full value even if they never click anything.
2. Mention observal at most ONCE, only if directly relevant, only after the manual answer,
   phrased like: "we're building observal for exactly this — free tier if useful." If the thread
   isn't about agent tracking/versioning/governance, do NOT mention the product at all.
3. No marketing words. No emoji walls. No "great question!". Write like a tired senior engineer
   who knows the answer and types fast.
4. Match the venue: HN = terse and direct; Discord/Slack = casual; Reddit = thorough.
5. If the right move is to NOT reply (thread is hostile, off-topic, or self-promo would burn
   credibility), say exactly that and explain why in one line.`;

export async function draftCommunityReply(thread: string, venue?: string): Promise<string> {
  await audit('copilot', 'draft.requested', { chars: thread.length, venue: venue ?? 'unspecified' });

  const draft = await complete(
    VOICE,
    `Venue: ${venue ?? 'unknown — infer from the text'}\n\nThread:\n${thread.slice(0, 6000)}\n\nDraft the reply (or advise not to reply).`,
  );

  await db.insert(schema.communityInteractions).values({
    person: 'unknown',
    community: venue ?? 'unknown',
    type: 'reply',
    notes: `drafted: ${draft.slice(0, 300)}`,
  });
  await audit('copilot', 'draft.returned', { words: draft.split(/\s+/).length });

  return `${draft}\n\n_— Copilot draft. Edit before posting; never paste verbatim into a community._`;
}
