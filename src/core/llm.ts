import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, generateObject } from 'ai';
import type { z } from 'zod';
import { config } from './config.js';

const google = createGoogleGenerativeAI({ apiKey: config.gemini.apiKey });

export const model = google(config.gemini.model);
export const modelQa = google(config.gemini.modelQa);

export async function complete(system: string, prompt: string, opts?: { qa?: boolean }) {
  const { text } = await generateText({
    model: opts?.qa ? modelQa : model,
    system,
    prompt,
  });
  return text;
}

export async function completeJson<SCHEMA extends z.ZodTypeAny>(
  system: string,
  prompt: string,
  schema: SCHEMA,
  opts?: { qa?: boolean },
): Promise<z.infer<SCHEMA>> {
  const { object } = await generateObject({
    model: opts?.qa ? modelQa : model,
    system,
    prompt,
    schema,
  });
  return object;
}
