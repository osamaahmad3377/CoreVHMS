import { env } from '../../config/env';
import { RequestContext } from '../context/request-context';

/** Subdomains a clinic cannot take. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'billing', 'cdn', 'dashboard', 'demo-admin', 'dev', 'docs', 'ftp', 'help',
  'imap', 'login', 'mail', 'mx', 'platform', 'pop', 'portal', 'root', 'smtp', 'staging', 'static', 'status', 'support',
  'test', 'www',
]);

/** 3–30 characters: lowercase letters, digits and single hyphens, starting with a letter. */
export const SLUG_PATTERN = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;

export function multiClinic(): boolean {
  return !!env().BASE_DOMAIN;
}

export function platformHost(): string {
  return `${env().PLATFORM_SUBDOMAIN}.${env().BASE_DOMAIN}`;
}

export type HostKind = { kind: 'single' } | { kind: 'platform' } | { kind: 'root' } | { kind: 'tenant'; slug: string } | { kind: 'unknown' };

/** Host name without port, lowercased. */
export function hostName(host: string | undefined): string {
  return (host ?? '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/** Which part of the system an address belongs to in multi-clinic mode. */
export function classifyHost(host: string | undefined): HostKind {
  const base = env().BASE_DOMAIN;
  if (!base) return { kind: 'single' };
  const name = hostName(host);
  if (name === base || name === `www.${base}`) return { kind: 'root' };
  if (name === platformHost()) return { kind: 'platform' };
  if (!name.endsWith(`.${base}`)) return { kind: 'unknown' };
  const slug = name.slice(0, -(base.length + 1));
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug) ? { kind: 'tenant', slug } : { kind: 'unknown' };
}

/** Web address of a clinic (or of the platform), keeping APP_URL's scheme and port. */
export function addressFor(subdomain: string | null): string {
  const url = new URL(env().APP_URL);
  if (env().BASE_DOMAIN) url.hostname = subdomain ? `${subdomain}.${env().BASE_DOMAIN}` : env().BASE_DOMAIN!;
  return url.origin;
}

/** Base web address for links in emails: the current clinic's subdomain in multi-clinic mode, otherwise APP_URL. */
export function appUrl(): string {
  if (!multiClinic()) return env().APP_URL.replace(/\/$/, '');
  const ctx = RequestContext.get();
  if (ctx?.tenant) return addressFor(ctx.tenant.slug);
  if (ctx?.platform) return addressFor(env().PLATFORM_SUBDOMAIN);
  return addressFor(null);
}

/**
 * Origin check for state-changing browser requests. In multi-clinic mode the request must come from a page on
 * the same address it was sent to (a page on one clinic's subdomain cannot post to another clinic or the platform).
 */
export function isAllowedOrigin(origin: string, requestHost: string | undefined): boolean {
  if (origin === `http://localhost:${env().PORT}`) return true;
  if (!multiClinic()) {
    if (origin === new URL(env().APP_URL).origin) return true;
    // Opened on this same machine by another loopback address (localhost, 127.0.0.1): fine. Any other address must
    // be the configured APP_URL, so a production server never trusts a host just because the request names it.
    try {
      const o = new URL(origin);
      return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(o.hostname) && !!requestHost && o.host === requestHost;
    } catch {
      return false;
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const kind = classifyHost(parsed.host);
  return kind.kind !== 'unknown' && hostName(parsed.host) === hostName(requestHost);
}
