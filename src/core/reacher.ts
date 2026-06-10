import { config } from './config.js';

export type VerifyResult = 'safe' | 'risky' | 'invalid' | 'unknown';

/**
 * Verify an email against the self-hosted Reacher instance (services/reacher).
 * Playbook rule: anything not 'safe' does NOT enter a sequence — bounce rate is
 * domain reputation, and there is no support ticket that un-burns a domain.
 */
export async function verifyEmail(email: string): Promise<VerifyResult> {
  let res: Response;
  try {
    res = await fetch(`${config.reacherUrl}/v0/check_email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to_email: email }),
    });
  } catch {
    return 'unknown'; // Reacher not running — callers treat unknown as "do not sequence"
  }
  if (!res.ok) return 'unknown';
  const data = (await res.json()) as { is_reachable?: string };
  switch (data.is_reachable) {
    case 'safe':
      return 'safe';
    case 'risky':
      return 'risky';
    case 'invalid':
      return 'invalid';
    default:
      return 'unknown';
  }
}
