import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// Argon2id, OWASP-recommended baseline parameters.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string | null | undefined, password: string): Promise<boolean> {
  if (!hashed) {
    // Spend comparable time to avoid user-enumeration timing differences.
    await hash(password, OPTIONS);
    return false;
  }
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

// No look-alike characters (0/O, 1/l/I) so a password read out or written down is typed correctly.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';

/**
 * A temporary password an administrator can share: four groups of four characters, e.g. "Kp7m-Qx4t-Zr9w-b3Hn"
 * (about 90 bits of randomness), always containing upper-case, lower-case and digits so it meets the password policy.
 */
export function generateTemporaryPassword(): string {
  const all = UPPER + LOWER + DIGITS;
  for (;;) {
    const chars = Array.from({ length: 16 }, () => all[randomInt(all.length)]);
    const s = chars.join('');
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s)) return s.match(/.{4}/g)!.join('-');
  }
}
