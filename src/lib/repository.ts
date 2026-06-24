import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { OtpRecord, VerifyOutcome } from '../types';
import { safeEqualHex } from './otp';

/**
 * DynamoDB persistence for OTP challenges. All mutating operations use conditional
 * expressions so concurrent requests cannot corrupt the attempt/consumed invariants.
 */
export class OtpRepository {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    region: string,
    doc?: DynamoDBDocumentClient,
  ) {
    this.doc =
      doc ??
      DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  async get(id: string): Promise<OtpRecord | undefined> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { id } }),
    );
    return out.Item as OtpRecord | undefined;
  }

  /**
   * Persist a brand-new challenge (overwriting any previous one for this email), carrying
   * forward the rolling send counters supplied by the caller.
   */
  async putNewChallenge(record: OtpRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({ TableName: this.tableName, Item: record }),
    );
  }

  /**
   * Atomically verify a submitted code.
   *
   * The clear-text code is hashed by the caller (so the pepper never reaches the repo) and
   * `expectedHashFor(record)` recomputes the candidate hash per stored salt. We:
   *  - reject expired / missing / consumed / locked records,
   *  - on mismatch, atomically increment `attempts` (locking the record when the cap is hit),
   *  - on match, atomically mark `consumed` so a code is single-use even under races.
   */
  async verify(
    id: string,
    candidateHashFor: (record: OtpRecord) => string,
    now: number,
  ): Promise<VerifyOutcome> {
    const record = await this.get(id);
    if (!record) return { result: 'not_found' };
    if (record.consumed) return { result: 'not_found' };
    if (record.expiresAt <= now) return { result: 'expired' };
    if (record.attempts >= record.maxAttempts) return { result: 'locked' };

    const candidateHash = candidateHashFor(record);
    const matches = safeEqualHex(candidateHash, record.codeHash);

    if (matches) {
      try {
        await this.doc.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { id },
            // `consumed`, `attempts` and `expiresAt` are DynamoDB reserved words, so every
            // attribute name is referenced via a `#alias` placeholder.
            UpdateExpression: 'SET #consumed = :true',
            // Only consume if still unconsumed and not expired — single-use guarantee.
            ConditionExpression:
              'attribute_exists(id) AND #consumed = :false AND #expiresAt > :now',
            ExpressionAttributeNames: {
              '#consumed': 'consumed',
              '#expiresAt': 'expiresAt',
            },
            ExpressionAttributeValues: {
              ':true': true,
              ':false': false,
              ':now': now,
            },
          }),
        );
        return { result: 'verified' };
      } catch (err) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
          // Lost a race — someone consumed it first, or it just expired.
          return { result: 'not_found' };
        }
        throw err;
      }
    }

    // Wrong code: atomically bump the attempt counter.
    const updated = await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        UpdateExpression: 'SET #attempts = #attempts + :one',
        ConditionExpression: 'attribute_exists(id) AND #consumed = :false',
        ExpressionAttributeNames: { '#attempts': 'attempts', '#consumed': 'consumed' },
        ExpressionAttributeValues: { ':one': 1, ':false': false },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const attempts = (updated.Attributes as OtpRecord).attempts;
    const remainingAttempts = Math.max(record.maxAttempts - attempts, 0);
    return { result: 'invalid', remainingAttempts };
  }
}
