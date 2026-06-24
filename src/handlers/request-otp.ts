import { Logger } from '@aws-lambda-powertools/logger';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { z } from 'zod';
import { loadConfig } from '../lib/config';
import { hashSourceIp, json, parseJsonBody } from '../lib/http';
import { generateCode, generateSalt, hashCode, normalizeEmail } from '../lib/otp';
import { evaluateSend } from '../lib/rate-limit';
import { OtpRepository } from '../lib/repository';
import { getPepper } from '../lib/secrets';
import { EmailSender } from '../lib/ses';
import type { OtpRecord } from '../types';

const logger = new Logger({ serviceName: 'otp-request' });

const RequestSchema = z.object({
  email: z.string().email().max(254),
  purpose: z
    .string()
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional()
    .default('login'),
});

// Cold-start singletons.
const config = loadConfig();
const repo = new OtpRepository(config.TABLE_NAME, config.AWS_REGION);
const sender = new EmailSender(config.SENDER_EMAIL, config.AWS_REGION);

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const requestId = event.requestContext?.requestId ?? 'unknown';

  const parsed = RequestSchema.safeParse(parseJsonBody(event));
  if (!parsed.success) {
    return json(400, { status: 'invalid_request', message: 'A valid email is required.' });
  }
  const { purpose } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const now = Math.floor(Date.now() / 1000);

  try {
    const existing = await repo.get(email);

    const decision = evaluateSend(existing, now, {
      resendCooldownSeconds: config.RESEND_COOLDOWN_SECONDS,
      maxSendsPerWindow: config.MAX_SENDS_PER_WINDOW,
      sendWindowSeconds: config.SEND_WINDOW_SECONDS,
    });
    if (!decision.allowed) {
      logger.info('Send rate-limited', { reason: decision.reason });
      return json(
        429,
        { status: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds },
        { 'retry-after': String(decision.retryAfterSeconds) },
      );
    }

    // Decide whether this send continues an existing window or starts a new one.
    const windowOpen =
      existing !== undefined && now - existing.createdAt < config.SEND_WINDOW_SECONDS;
    const createdAt = windowOpen ? existing!.createdAt : now;
    const sendCount = windowOpen ? existing!.sendCount + 1 : 1;

    const pepper = await getPepper(config.PEPPER_SECRET_ARN, config.AWS_REGION);
    const code = generateCode(config.CODE_LENGTH);
    const salt = generateSalt();

    const record: OtpRecord = {
      id: email,
      purpose,
      codeHash: hashCode({ code, salt, purpose, pepper }),
      salt,
      expiresAt: now + config.CODE_TTL_SECONDS,
      attempts: 0,
      maxAttempts: config.MAX_VERIFY_ATTEMPTS,
      sendCount,
      lastSentAt: now,
      createdAt,
      consumed: false,
      ipHash: hashSourceIp(event),
    };

    // Persist before sending: a stored-but-unsent code is harmless; a sent-but-unstored one
    // would be unverifiable.
    await repo.putNewChallenge(record);

    const messageId = await sender.sendOtp({
      to: email,
      code,
      ttlSeconds: config.CODE_TTL_SECONDS,
      purpose,
    });
    logger.info('OTP sent', { messageId, requestId });

    return json(202, {
      status: 'sent',
      expiresInSeconds: config.CODE_TTL_SECONDS,
      requestId,
    });
  } catch (err) {
    logger.error('Failed to process OTP request', err as Error);
    return json(500, { status: 'error', message: 'Unable to process request.' });
  }
};
