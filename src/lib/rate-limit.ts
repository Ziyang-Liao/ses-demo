import type { OtpRecord } from '../types';

export interface RateLimitPolicy {
  /** Minimum seconds between two sends to the same email. */
  resendCooldownSeconds: number;
  /** Max sends allowed to the same email within the rolling window. */
  maxSendsPerWindow: number;
  /** Length of the rolling send window, in seconds. */
  sendWindowSeconds: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'window_exceeded'; retryAfterSeconds: number };

/**
 * Pure decision function: given the existing record (if any) and the current time, decide
 * whether a new send is permitted. Kept side-effect free so it is trivially unit-testable.
 */
export function evaluateSend(
  existing: OtpRecord | undefined,
  now: number,
  policy: RateLimitPolicy,
): RateLimitDecision {
  if (!existing) {
    return { allowed: true };
  }

  // If the previous challenge window has fully elapsed, the counter resets.
  const windowStillOpen = now - existing.createdAt < policy.sendWindowSeconds;
  if (!windowStillOpen) {
    return { allowed: true };
  }

  const sinceLastSend = now - existing.lastSentAt;
  if (sinceLastSend < policy.resendCooldownSeconds) {
    return {
      allowed: false,
      reason: 'cooldown',
      retryAfterSeconds: policy.resendCooldownSeconds - sinceLastSend,
    };
  }

  if (existing.sendCount >= policy.maxSendsPerWindow) {
    const retryAfterSeconds =
      policy.sendWindowSeconds - (now - existing.createdAt);
    return {
      allowed: false,
      reason: 'window_exceeded',
      retryAfterSeconds: Math.max(retryAfterSeconds, 1),
    };
  }

  return { allowed: true };
}
