import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal stateless verification token: base64url(payload).base64url(HMAC-SHA256(payload)).
 *
 * Issued only after a successful OTP verification so a downstream service can trust that this
 * email was proven within the last few minutes — without re-checking the OTP table. Keyed by
 * the same server-side pepper, so it cannot be forged by clients.
 */

export interface TokenPayload {
  /** Subject — the verified, normalized email. */
  sub: string;
  /** Purpose the verification was for. */
  purpose: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function issueToken(payload: TokenPayload, pepper: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', pepper).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(
  token: string,
  pepper: string,
  now: number,
): TokenPayload | undefined {
  const parts = token.split('.');
  if (parts.length !== 2) return undefined;
  const [body, sig] = parts;
  const expected = b64url(createHmac('sha256', pepper).update(body).digest());
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return undefined;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (payload.exp <= now) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}
