import { createHash } from 'node:crypto';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

/** Build a JSON HTTP response for API Gateway HTTP API (payload v2). */
export function json(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

/** Safely parse a JSON request body, returning undefined on any malformed input. */
export function parseJsonBody<T = unknown>(
  event: APIGatewayProxyEventV2,
): T | undefined {
  if (!event.body) return undefined;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Derive a privacy-preserving hash of the requester's source IP (we never store raw IPs). */
export function hashSourceIp(event: APIGatewayProxyEventV2): string {
  const ip = event.requestContext?.http?.sourceIp ?? 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}
