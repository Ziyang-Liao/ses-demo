import { issueToken, verifyToken } from '../src/lib/token';

const PEPPER = 'unit-test-pepper';

describe('verification token', () => {
  const now = 1_000_000;
  const payload = { sub: 'user@example.com', purpose: 'otp', iat: now, exp: now + 300 };

  it('round-trips a freshly issued token', () => {
    const token = issueToken(payload, PEPPER);
    expect(verifyToken(token, PEPPER, now + 10)).toMatchObject({ sub: 'user@example.com' });
  });

  it('rejects an expired token', () => {
    const token = issueToken(payload, PEPPER);
    expect(verifyToken(token, PEPPER, now + 301)).toBeUndefined();
  });

  it('rejects a token signed with a different pepper (forgery)', () => {
    const token = issueToken(payload, PEPPER);
    expect(verifyToken(token, 'attacker-pepper', now + 10)).toBeUndefined();
  });

  it('rejects a tampered payload', () => {
    const token = issueToken(payload, PEPPER);
    const [, sig] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, sub: 'admin@example.com' })).toString('base64url');
    expect(verifyToken(`${forgedBody}.${sig}`, PEPPER, now + 10)).toBeUndefined();
  });

  it('rejects malformed tokens', () => {
    expect(verifyToken('garbage', PEPPER, now)).toBeUndefined();
    expect(verifyToken('a.b.c', PEPPER, now)).toBeUndefined();
  });
});
