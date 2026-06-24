import { evaluateSend, type RateLimitPolicy } from '../src/lib/rate-limit';
import type { OtpRecord } from '../src/types';

const policy: RateLimitPolicy = {
  resendCooldownSeconds: 60,
  maxSendsPerWindow: 5,
  sendWindowSeconds: 3600,
};

function record(overrides: Partial<OtpRecord>): OtpRecord {
  return {
    id: 'user@example.com',
    purpose: 'login',
    codeHash: 'x',
    salt: 'y',
    expiresAt: 0,
    attempts: 0,
    maxAttempts: 5,
    sendCount: 1,
    lastSentAt: 1000,
    createdAt: 1000,
    consumed: false,
    ipHash: 'z',
    ...overrides,
  };
}

describe('evaluateSend', () => {
  it('allows the first send (no existing record)', () => {
    expect(evaluateSend(undefined, 1000, policy)).toEqual({ allowed: true });
  });

  it('blocks a resend within the cooldown window', () => {
    const r = record({ lastSentAt: 1000, createdAt: 1000, sendCount: 1 });
    const d = evaluateSend(r, 1030, policy); // 30s later, cooldown is 60s
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe('cooldown');
      expect(d.retryAfterSeconds).toBe(30);
    }
  });

  it('allows a resend once the cooldown has elapsed and the cap is not reached', () => {
    const r = record({ lastSentAt: 1000, createdAt: 1000, sendCount: 2 });
    expect(evaluateSend(r, 1061, policy)).toEqual({ allowed: true });
  });

  it('blocks once the per-window send cap is reached', () => {
    const r = record({ lastSentAt: 1000, createdAt: 1000, sendCount: 5 });
    const d = evaluateSend(r, 1200, policy); // past cooldown, but at the cap
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('window_exceeded');
  });

  it('resets the counter after the window fully elapses', () => {
    const r = record({ lastSentAt: 1000, createdAt: 1000, sendCount: 5 });
    // 3601s later → outside the window → fresh allowance.
    expect(evaluateSend(r, 1000 + 3601, policy)).toEqual({ allowed: true });
  });
});
