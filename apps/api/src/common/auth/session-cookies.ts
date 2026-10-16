import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env';

export const SESSION_COOKIE = 'vcms_sid';
export const CSRF_COOKIE = 'vcms_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const BRANCH_HEADER = 'x-branch-id';

function base(): CookieOptions {
  return { secure: env().COOKIE_SECURE, sameSite: 'lax', path: '/' };
}

export function setSessionCookies(res: Response, token: string, csrf: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, { ...base(), httpOnly: true, expires: expiresAt });
  // Readable by the web app so it can echo it in the X-CSRF-Token header (double-submit).
  res.cookie(CSRF_COOKIE, csrf, { ...base(), httpOnly: false, expires: expiresAt });
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, base());
  res.clearCookie(CSRF_COOKIE, base());
}
