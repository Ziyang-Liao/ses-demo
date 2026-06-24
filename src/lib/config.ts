import { z } from 'zod';

/**
 * Runtime configuration, validated from environment variables at cold start.
 *
 * NOTE: No secrets are read from here. The HMAC pepper lives in Secrets Manager and is
 * fetched at runtime (see secrets.ts); only its ARN — a non-secret reference — is passed in.
 */
const ConfigSchema = z.object({
  TABLE_NAME: z.string().min(1),
  SENDER_EMAIL: z.string().email(),
  PEPPER_SECRET_ARN: z.string().min(1),
  CODE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  CODE_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  MAX_SENDS_PER_WINDOW: z.coerce.number().int().positive().default(5),
  SEND_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
  AWS_REGION: z.string().min(1).default('us-east-1'),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | undefined;

/** Parse and cache configuration. Throws a descriptive error if anything is missing/invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid service configuration: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: clear the memoized config so a fresh env can be loaded. */
export function resetConfigCache(): void {
  cached = undefined;
}
