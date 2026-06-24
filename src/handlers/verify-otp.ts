import { Logger } from '@aws-lambda-powertools/logger';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { z } from 'zod';
import { loadConfig } from '../lib/config';
import { json, parseJsonBody } from '../lib/http';
import { hashCode, normalizeEmail } from '../lib/otp';
import { OtpRepository } from '../lib/repository';
import { getPepper } from '../lib/secrets';
import { issueToken } from '../lib/token';

const logger = new Logger({ serviceName: 'otp-verify' });

const VerifySchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^[0-9]{4,10}$/),
});

const config = loadConfig();
const repo = new OtpRepository(config.TABLE_NAME, config.AWS_REGION);

/** Token lifetime after a successful verification. */
const VERIFICATION_TOKEN_TTL_SECONDS = 300;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const parsed = VerifySchema.safeParse(parseJsonBody(event));
  if (!parsed.success) {
    return json(400, { status: 'invalid_request', message: 'Email and numeric code are required.' });
  }
  const { code } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const now = Math.floor(Date.now() / 1000);

  try {
    const pepper = await getPepper(config.PEPPER_SECRET_ARN, config.AWS_REGION);

    const outcome = await repo.verify(
      email,
      (record) => hashCode({ code, salt: record.salt, purpose: record.purpose, pepper }),
      now,
    );

    switch (outcome.result) {
      case 'verified': {
        const token = issueToken(
          {
            sub: email,
            purpose: 'otp',
            iat: now,
            exp: now + VERIFICATION_TOKEN_TTL_SECONDS,
          },
          pepper,
        );
        logger.info('OTP verified');
        return json(200, {
          status: 'verified',
          verificationToken: token,
          expiresInSeconds: VERIFICATION_TOKEN_TTL_SECONDS,
        });
      }
      case 'invalid':
        return json(401, { status: 'invalid', remainingAttempts: outcome.remainingAttempts });
      case 'locked':
        return json(429, { status: 'locked', message: 'Too many attempts. Request a new code.' });
      case 'expired':
        return json(410, { status: 'expired', message: 'Code expired. Request a new one.' });
      case 'not_found':
      default:
        // Generic to avoid leaking whether a challenge exists for this email.
        return json(410, { status: 'expired', message: 'Code expired. Request a new one.' });
    }
  } catch (err) {
    logger.error('Failed to verify OTP', err as Error);
    return json(500, { status: 'error', message: 'Unable to process request.' });
  }
};
