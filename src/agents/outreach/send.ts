import { getAgentMail } from '../../core/agentmail.js';
import { audit } from '../../core/audit.js';

/**
 * Email send via AgentMail — the inbox id is the sending address itself.
 * RFC 8058 one-click unsubscribe headers on every send (Gmail bulk-sender
 * requirement). Returns the provider message id, or null when sending was
 * impossible.
 */
export async function sendEmail(opts: {
  inboxEmail: string;
  to: string;
  subject: string;
  body: string;
  unsubscribeUrl: string;
}): Promise<string | null> {
  const agentmail = getAgentMail();
  if (!agentmail) {
    await audit('outreach', 'send.skipped', { reason: 'no AGENTMAIL_API_KEY', to: opts.to });
    return null;
  }
  const result = await agentmail.inboxes.messages.send(opts.inboxEmail, {
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    headers: {
      'List-Unsubscribe': `<${opts.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  return result.messageId ?? null;
}
