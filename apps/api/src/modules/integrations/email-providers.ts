import nodemailer from 'nodemailer';
import { env } from '../../config/env';

/**
 * Talking to Gmail (Google) and Outlook (Microsoft 365) for clinic mailboxes signed in with OAuth: sign-in links,
 * code and refresh-token exchange, the account's address, and sending. Addresses are configurable so tests can
 * point them at a fake server.
 */

export type OAuthProvider = 'GMAIL' | 'OUTLOOK';

export class ProviderError extends Error {
  constructor(
    message: string,
    /** The provider no longer accepts the mailbox's access (revoked, password changed): reconnect needed. */
    readonly authProblem = false,
  ) {
    super(message);
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  /** Google: the id_token carries the signed-in address. */
  idToken?: string | null;
}

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
}

const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'];
const MICROSOFT_SCOPES = ['offline_access', 'openid', 'email', 'User.Read', 'Mail.Send'];

export function oauthAvailable() {
  const e = env();
  return { GMAIL: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET), OUTLOOK: !!(e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET) };
}

export function redirectUri() {
  const e = env();
  return `${(e.OAUTH_REDIRECT_URL ?? e.APP_URL).replace(/\/$/, '')}/api/v1/oauth/email/callback`;
}

const msBase = () => `${env().MICROSOFT_LOGIN_URL.replace(/\/$/, '')}/${env().MICROSOFT_TENANT}/oauth2/v2.0`;

/** Where the clinic signs in to give the app permission to send email. */
export function authorizeUrl(provider: OAuthProvider, state: string, loginHint?: string | null) {
  const e = env();
  const p =
    provider === 'GMAIL'
      ? new URLSearchParams({ client_id: e.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: 'code', scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })
      : new URLSearchParams({ client_id: e.MICROSOFT_CLIENT_ID!, redirect_uri: redirectUri(), response_type: 'code', response_mode: 'query', scope: MICROSOFT_SCOPES.join(' '), prompt: 'select_account', state });
  if (loginHint) p.set('login_hint', loginHint);
  return `${provider === 'GMAIL' ? e.GOOGLE_AUTH_URL : `${msBase()}/authorize`}?${p}`;
}

async function tokenRequest(provider: OAuthProvider, body: Record<string, string>): Promise<TokenSet> {
  const e = env();
  const url = provider === 'GMAIL' ? e.GOOGLE_TOKEN_URL : `${msBase()}/token`;
  const creds: Record<string, string> = provider === 'GMAIL' ? { client_id: e.GOOGLE_CLIENT_ID!, client_secret: e.GOOGLE_CLIENT_SECRET! } : { client_id: e.MICROSOFT_CLIENT_ID!, client_secret: e.MICROSOFT_CLIENT_SECRET!, scope: MICROSOFT_SCOPES.join(' ') };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...creds, ...body }) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    const code = String(json.error ?? res.status);
    // invalid_grant: the refresh token was revoked or expired — the clinic has to sign in again.
    throw new ProviderError(String(json.error_description ?? json.error ?? `Sign-in failed (${res.status})`), code === 'invalid_grant' || res.status === 401);
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresAt: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000 - 60_000),
    idToken: typeof json.id_token === 'string' ? json.id_token : null,
  };
}

export const exchangeCode = (provider: OAuthProvider, code: string) => tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
export const refreshAccess = (provider: OAuthProvider, refreshToken: string) => tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refreshToken });

/** The address that signed in. */
export async function accountEmail(provider: OAuthProvider, t: TokenSet): Promise<string> {
  if (provider === 'GMAIL') {
    // The id_token comes straight from Google's token endpoint over TLS; its email claim names the account.
    const claims = t.idToken ? (JSON.parse(Buffer.from(t.idToken.split('.')[1] ?? '', 'base64url').toString('utf8') || '{}') as { email?: string }) : {};
    if (claims.email) return claims.email.toLowerCase();
    throw new ProviderError('Google did not say which account signed in');
  }
  const res = await fetch(`${env().MICROSOFT_GRAPH_URL.replace(/\/$/, '')}/v1.0/me`, { headers: { Authorization: `Bearer ${t.accessToken}` } });
  const me = (await res.json().catch(() => ({}))) as { mail?: string | null; userPrincipalName?: string };
  const email = me.mail ?? me.userPrincipalName;
  if (!res.ok || !email) throw new ProviderError('Microsoft did not say which account signed in', res.status === 401);
  return email.toLowerCase();
}

/** Sends one email from the signed-in mailbox. */
export async function sendWithProvider(provider: OAuthProvider, accessToken: string, m: OutgoingEmail): Promise<string | null> {
  if (provider === 'GMAIL') {
    // The complete message (headers, text and HTML parts) as Gmail expects it, built by nodemailer without sending.
    const built = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' }).sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo ?? undefined });
    const raw = built.message as Buffer;
    const res = await fetch(`${env().GMAIL_API_URL.replace(/\/$/, '')}/gmail/v1/users/me/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: raw.toString('base64url') }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok) throw new ProviderError(json.error?.message ?? `Gmail refused the message (${res.status})`, res.status === 401 || res.status === 403);
    return json.id ?? null;
  }
  const res = await fetch(`${env().MICROSOFT_GRAPH_URL.replace(/\/$/, '')}/v1.0/me/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: m.subject,
        body: { contentType: 'HTML', content: m.html },
        toRecipients: [{ emailAddress: { address: m.to } }],
        ...(m.replyTo ? { replyTo: [{ emailAddress: { address: m.replyTo } }] } : {}),
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new ProviderError(json.error?.message ?? `Outlook refused the message (${res.status})`, res.status === 401 || res.status === 403);
  }
  return null;
}
