import { getComposio, ENTITY } from '../../core/composio.js';
import { audit } from '../../core/audit.js';

/**
 * Gmail send via the inbox's own Composio connection. RFC 8058 one-click
 * unsubscribe headers on every send (Gmail bulk-sender requirement).
 * Returns the Gmail message id, or null when sending was impossible.
 */
export async function sendEmail(opts: {
  inboxEmail: string;
  to: string;
  subject: string;
  body: string;
  unsubscribeUrl: string;
}): Promise<string | null> {
  const composio = getComposio();
  if (!composio) {
    await audit('outreach', 'send.skipped', { reason: 'no COMPOSIO_API_KEY', to: opts.to });
    return null;
  }
  const result = await composio.tools.execute('GMAIL_SEND_EMAIL', {
    userId: ENTITY.inbox(opts.inboxEmail),
    arguments: {
      recipient_email: opts.to,
      subject: opts.subject,
      body: opts.body,
      extra_headers: {
        'List-Unsubscribe': `<${opts.unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    },
  });
  const data = result.data as { response_data?: { id?: string } } | undefined;
  return data?.response_data?.id ?? null;
}
