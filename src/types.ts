/**
 * Shared domain types for the OTP service.
 */

/** A single OTP challenge as persisted in DynamoDB. The clear-text code is NEVER stored. */
export interface OtpRecord {
  /** Partition key: normalized (lower-cased, trimmed) email address. */
  id: string;
  /** Logical purpose of the code, e.g. "login" or "signup". Part of the HMAC input. */
  purpose: string;
  /** HMAC-SHA256(code) in hex. */
  codeHash: string;
  /** Per-record random salt (hex) mixed into the HMAC alongside the server-side pepper. */
  salt: string;
  /** Epoch seconds when this record expires. Also the DynamoDB TTL attribute. */
  expiresAt: number;
  /** Number of verification attempts made so far. */
  attempts: number;
  /** Maximum verification attempts allowed before the code is invalidated. */
  maxAttempts: number;
  /** Number of times a code has been (re)sent for this email within the rolling window. */
  sendCount: number;
  /** Epoch seconds of the most recent send (used for resend cooldown). */
  lastSentAt: number;
  /** Epoch seconds when the active challenge was first created. */
  createdAt: number;
  /** Marks a code as already consumed so it can only be used once. */
  consumed: boolean;
  /** SHA-256 hash of the requester IP (we never store raw IPs). */
  ipHash: string;
}

/** Outcome of a verification attempt, returned by the repository/verify logic. */
export type VerifyOutcome =
  | { result: 'verified' }
  | { result: 'invalid'; remainingAttempts: number }
  | { result: 'expired' }
  | { result: 'not_found' }
  | { result: 'locked' };
