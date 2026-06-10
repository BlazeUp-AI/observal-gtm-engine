import { z } from 'zod';
import { completeJson } from '../../core/llm.js';
import { config } from '../../core/config.js';

const openerSchema = z.object({
  opener: z.string().describe('1-2 sentences, references their specific work, sounds like one engineer noticing another'),
  confidence: z.enum(['high', 'medium', 'low']).describe('low if the signal is too thin to reference specifically'),
});

/**
 * Generate the {{opener}} from the contact's captured signal — playbook §9.4 B1.
 * Then code-level QA: word budget, banned words. Returns null if QA fails or
 * confidence is low — null means the contact goes to the manual-review lane,
 * never a generic blast.
 */
export async function generateOpener(input: {
  name: string;
  company: string;
  signalUrl: string | null;
  signalSummary: string | null;
}): Promise<string | null> {
  if (!input.signalUrl && !input.signalSummary) return null;

  const out = await completeJson(
    `You write the first 1-2 sentences of a cold email from one engineer to another.
Rules: reference ONLY what the signal actually shows — never invent details. No flattery
("impressive", "love what you're doing"). No marketing words. Casual, specific, brief.
Example shape: "Hi {{first}} — saw the {{company}} post about your support triage agent on LangGraph. Nice work."
If the signal is too thin to reference something specific, set confidence to "low".`,
    `Contact: ${input.name} at ${input.company}
Signal URL: ${input.signalUrl ?? 'n/a'}
Signal summary: ${input.signalSummary ?? 'n/a'}

Write the opener.`,
    openerSchema,
  );

  if (out.confidence === 'low') return null;
  if (!qaPasses(out.opener)) return null;
  return out.opener;
}

export function qaPasses(text: string): boolean {
  const words = text.trim().split(/\s+/).length;
  if (words > 45) return false; // opener budget; full email budget enforced at compose time
  const lower = text.toLowerCase();
  return !config.bannedWords.some((w) => lower.includes(w));
}

export function fullEmailQaPasses(body: string): boolean {
  const words = body.trim().split(/\s+/).length;
  if (words > config.outreach.maxWords + 20) return false; // template + opener headroom
  const lower = body.toLowerCase();
  return !config.bannedWords.some((w) => lower.includes(w));
}
