import { z } from 'zod';
import { completeJson } from '../../core/llm.js';
import type { RawLead, ExtractedAccount } from './types.js';

const extractionSchema = z.object({
  isCompanyLead: z.boolean().describe('true only if a specific company running/hiring-for AI agents is identifiable'),
  company: z.string(),
  domain: z.string().nullable().describe('company website domain like acme.com, null if unknown'),
  archetype: z.enum([
    'agency',
    'fintech',
    'support_automation',
    'devtool',
    'regulated',
    'platform_team',
    'ecommerce',
    'internal_automation',
    'other',
  ]),
  icpScore: z.number().min(0).max(100),
  rationale: z.string().describe('2-3 sentences justifying the score against the rubric'),
  agentStackEvidence: z.string().describe('the specific phrase/evidence of agents in production or hiring'),
});

const RUBRIC = `You score companies for observal.io — a system of record for AI agents in the enterprise
(registry, versioning, governance). The ideal customer ("feels-the-pain-today"):

SCORE HIGH (70-100):
- Evidence of 2+ AI agents in production or active hiring for agent engineering (LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, Bedrock Agents, "agentic")
- 150-5,000 employees; Series B+ or profitable
- Regulated-adjacent (fintech, insurtech, healthtech, legaltech) OR AI-native SaaS
- Already uses agent observability (LangSmith, Langfuse, Braintrust, Arize) — governance pain follows observability adoption
- AI consultancies/agencies building agents for clients score high (fast wins, multi-client registry pain)

SCORE LOW (0-40):
- Solo devs, hobby projects, students, agencies of one
- Companies merely "exploring AI" with no agents shipped or hired for
- 5,000+ employee enterprises (procurement kills a 20-day free-tier motion)
- The lead is about a product FOR building agents with no identifiable customer company

Be skeptical: a blog post about agents is weaker evidence than a job post requiring agent frameworks.`;

export async function extractAndScore(lead: RawLead): Promise<ExtractedAccount | null> {
  const out = await completeJson(
    RUBRIC,
    `Lead from ${lead.source} (${lead.url}):\n\n${lead.text}\n\nExtract the company and score it.`,
    extractionSchema,
  );
  if (!out.isCompanyLead || out.icpScore <= 0) return null;
  return {
    company: out.company,
    domain: out.domain,
    archetype: out.archetype,
    icpScore: out.icpScore,
    rationale: out.rationale,
    agentStackEvidence: out.agentStackEvidence,
  };
}
