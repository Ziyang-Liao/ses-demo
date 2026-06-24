import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { OtpRepository } from '../src/lib/repository';
import type { OtpRecord } from '../src/types';

/** Minimal fake DynamoDBDocumentClient driven by a single in-memory item. */
class FakeDoc {
  item: OtpRecord | undefined;
  constructor(initial?: OtpRecord) {
    this.item = initial;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send(command: any): Promise<any> {
    if (command instanceof GetCommand) {
      return { Item: this.item };
    }
    if (command instanceof PutCommand) {
      this.item = command.input.Item as OtpRecord;
      return {};
    }
    if (command instanceof UpdateCommand) {
      const rawExpr = `${command.input.UpdateExpression ?? ''} ${command.input.ConditionExpression ?? ''}`;
      // Guard against the real DynamoDB reserved-keyword error: these attribute names MUST be
      // referenced through #aliases, never bare. This mirrors the ValidationException DynamoDB
      // throws and prevents that bug from regressing.
      for (const reserved of ['consumed', 'attempts', 'expiresAt']) {
        if (new RegExp(`(^|[^#\\w])${reserved}\\b`).test(rawExpr)) {
          throw Object.assign(
            new Error(`Invalid expression: reserved keyword: ${reserved}`),
            { name: 'ValidationException' },
          );
        }
      }
      // Resolve #aliases back to attribute names so the rest of the fake can match intent.
      const names = (command.input.ExpressionAttributeNames ?? {}) as Record<string, string>;
      const expr = Object.entries(names).reduce(
        (acc, [alias, name]) => acc.split(alias).join(name),
        command.input.UpdateExpression as string,
      );
      if (!this.item) throw Object.assign(new Error('no item'), { name: 'ConditionalCheckFailedException' });
      if (expr.includes('consumed = :true')) {
        if (this.item.consumed) {
          throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
        }
        this.item = { ...this.item, consumed: true };
        return {};
      }
      if (expr.includes('attempts = attempts + :one')) {
        this.item = { ...this.item, attempts: this.item.attempts + 1 };
        return { Attributes: this.item };
      }
    }
    throw new Error('unexpected command');
  }
}

function baseRecord(overrides: Partial<OtpRecord> = {}): OtpRecord {
  return {
    id: 'user@example.com',
    purpose: 'login',
    codeHash: 'deadbeef',
    salt: 'salt',
    expiresAt: 2000,
    attempts: 0,
    maxAttempts: 5,
    sendCount: 1,
    lastSentAt: 1000,
    createdAt: 1000,
    consumed: false,
    ipHash: 'iphash',
    ...overrides,
  };
}

function repoWith(item?: OtpRecord): { repo: OtpRepository; doc: FakeDoc } {
  const doc = new FakeDoc(item);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repo = new OtpRepository('table', 'us-east-1', doc as any);
  return { repo, doc };
}

const NOW = 1500;
const matchHash = (r: OtpRecord) => r.codeHash; // pretend the candidate equals the stored hash
const wrongHash = () => 'ffffffff';

describe('OtpRepository.verify', () => {
  it('verifies a correct code and marks it consumed (single-use)', async () => {
    const { repo, doc } = repoWith(baseRecord());
    const outcome = await repo.verify('user@example.com', matchHash, NOW);
    expect(outcome).toEqual({ result: 'verified' });
    expect(doc.item?.consumed).toBe(true);

    // Re-verifying a consumed code must fail (treated as not_found / generic).
    const second = await repo.verify('user@example.com', matchHash, NOW);
    expect(second.result).toBe('not_found');
  });

  it('returns not_found when no record exists', async () => {
    const { repo } = repoWith(undefined);
    expect(await repo.verify('user@example.com', matchHash, NOW)).toEqual({ result: 'not_found' });
  });

  it('returns expired for a past-TTL record', async () => {
    const { repo } = repoWith(baseRecord({ expiresAt: 1000 }));
    expect(await repo.verify('user@example.com', matchHash, NOW)).toEqual({ result: 'expired' });
  });

  it('returns locked once attempts reach the cap', async () => {
    const { repo } = repoWith(baseRecord({ attempts: 5, maxAttempts: 5 }));
    expect(await repo.verify('user@example.com', matchHash, NOW)).toEqual({ result: 'locked' });
  });

  it('increments attempts and reports remaining on a wrong code', async () => {
    const { repo, doc } = repoWith(baseRecord({ attempts: 0, maxAttempts: 5 }));
    const outcome = await repo.verify('user@example.com', wrongHash, NOW);
    expect(outcome).toEqual({ result: 'invalid', remainingAttempts: 4 });
    expect(doc.item?.attempts).toBe(1);
  });
});
