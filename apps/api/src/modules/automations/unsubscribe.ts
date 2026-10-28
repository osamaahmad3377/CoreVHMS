import { createHmac } from 'node:crypto';
import { safeEqual } from '../../common/crypto/crypto';
import { appUrl } from '../../common/tenancy/hosts';
import { env } from '../../config/env';

const sign = (body: string) => createHmac('sha256', env().SESSION_SECRET).update(`marketing-unsubscribe:${body}`).digest('base64url').slice(0, 32);

/** A link-safe token naming one client of one clinic, signed so nobody can make one for someone else. */
export function unsubscribeToken(organizationId: string, clientId: string) {
  const body = Buffer.from(`${organizationId}.${clientId}`).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readUnsubscribeToken(token: string): { organizationId: string; clientId: string } | null {
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig || !safeEqual(sig, sign(body))) return null;
  const [organizationId, clientId] = Buffer.from(body, 'base64url').toString('utf8').split('.');
  const uuid = /^[0-9a-f-]{36}$/i;
  return uuid.test(organizationId ?? '') && uuid.test(clientId ?? '') ? { organizationId, clientId } : null;
}

/** "Stop offers" page on the clinic's own address. */
export const unsubscribeLink = (organizationId: string, clientId: string) => `${appUrl()}/unsubscribe?t=${encodeURIComponent(unsubscribeToken(organizationId, clientId))}`;

/** Words a client can reply on WhatsApp to stop offers. */
export const STOP_WORDS = new Set(['STOP', 'STOP OFFERS', 'UNSUBSCRIBE', 'NO OFFERS', 'NO MORE OFFERS']);
