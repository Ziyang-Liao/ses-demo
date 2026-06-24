import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

/**
 * Fetches the HMAC pepper from Secrets Manager and caches it for the lifetime of the
 * execution environment (Lambda container). The pepper is never written to logs, never
 * exposed as a plain environment variable, and never committed to source control — only
 * its ARN is passed to the function.
 */

let client: SecretsManagerClient | undefined;
let cachedPepper: string | undefined;

function getClient(region: string): SecretsManagerClient {
  if (!client) {
    client = new SecretsManagerClient({ region });
  }
  return client;
}

export async function getPepper(secretArn: string, region: string): Promise<string> {
  if (cachedPepper) return cachedPepper;

  const out = await getClient(region).send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  // The secret is stored as JSON: { "pepper": "<random>" }.
  const raw = out.SecretString;
  if (!raw) {
    throw new Error('Pepper secret has no string value');
  }
  let pepper: string;
  try {
    const parsed = JSON.parse(raw) as { pepper?: string };
    if (!parsed.pepper) throw new Error('missing "pepper" field');
    pepper = parsed.pepper;
  } catch (err) {
    throw new Error(`Malformed pepper secret: ${(err as Error).message}`);
  }

  cachedPepper = pepper;
  return cachedPepper;
}

/** Test helper to reset the module-level cache between tests. */
export function resetSecretsCache(): void {
  client = undefined;
  cachedPepper = undefined;
}
