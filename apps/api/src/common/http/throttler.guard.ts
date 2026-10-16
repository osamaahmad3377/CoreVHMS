import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { SESSION_COOKIE } from '../auth/session-cookies';

/**
 * Rate limits per signed-in session rather than per IP, so a whole clinic behind one
 * NAT/office IP does not share a single budget. Anonymous traffic (login, reset) stays per IP.
 */
@Injectable()
export class SessionAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const sid = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (sid) return `s:${createHash('sha256').update(sid).digest('hex').slice(0, 24)}`;
    return `ip:${req.ip}`;
  }
}
