import { db, schema } from './db.js';

/**
 * Every external action any agent takes goes through here.
 * This audit trail is also the dogfood narrative: it is exactly the kind of
 * record observal.io sells. Register each agent in our own workspace.
 */
export async function audit(agent: string, action: string, payload?: unknown) {
  await db.insert(schema.auditLog).values({
    agent,
    action,
    payloadJson: payload === undefined ? null : JSON.stringify(payload),
  });
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] [${agent}] ${action}`);
}
