import { AgentMailClient } from 'agentmail';
import { config } from './config.js';

/**
 * AgentMail is the email layer: programmatic inboxes on our cold-email domains,
 * API send with custom headers, reply polling, managed SPF/DKIM/DMARC + suppression.
 * Inbox ids ARE email addresses (e.g. aryan@useobserval.xyz).
 */
let _client: AgentMailClient | null = null;

/** Lazy init — the engine must boot (and dry-run) before keys are configured. */
export function getAgentMail(): AgentMailClient | null {
  if (!config.agentmail.apiKey) return null;
  _client ??= new AgentMailClient({ apiKey: config.agentmail.apiKey });
  return _client;
}
