import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * OTP code generation and hashing primitives.
 *
 * The clear-text code is only ever held in memory long enough to email it. What we persist
 * is HMAC-SHA256(code) keyed by a server-side `pepper` (from Secrets Manager) and mixed with
 * a per-record random `salt`. This means a database leak alone does not reveal codes, and
 * identical codes for different records produce different hashes.
 */

/** Normalize an email for use as a stable partition key. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Generate a numeric one-time code of `length` digits using a CSPRNG.
 * Leading zeros are preserved (the value is left-padded to the requested length).
 */
export function generateCode(length: number): string {
  if (length < 4 || length > 10) {
    throw new Error(`Unsupported code length: ${length}`);
  }
  const max = 10 ** length;
  // randomInt is uniform over [0, max), so no modulo bias.
  return randomInt(0, max).toString().padStart(length, '0');
}

/** Generate a fresh per-record salt (hex). */
export function generateSalt(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Compute HMAC-SHA256 over the code, bound to its purpose and salt, keyed by the pepper.
 * Binding the purpose prevents a code minted for one flow from validating in another.
 */
export function hashCode(params: {
  code: string;
  salt: string;
  purpose: string;
  pepper: string;
}): string {
  const { code, salt, purpose, pepper } = params;
  return createHmac('sha256', pepper)
    .update(`${salt}:${purpose}:${code}`)
    .digest('hex');
}

/** Constant-time comparison of two hex-encoded hashes of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
