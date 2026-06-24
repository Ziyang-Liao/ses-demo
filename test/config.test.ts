import { loadConfig, resetConfigCache } from '../src/lib/config';

const VALID = {
  TABLE_NAME: 'otp',
  SENDER_EMAIL: 'noreply@example.com',
  PEPPER_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:111:secret:x',
};

describe('loadConfig', () => {
  beforeEach(() => resetConfigCache());

  it('applies defaults for optional values', () => {
    const cfg = loadConfig({ ...VALID } as NodeJS.ProcessEnv);
    expect(cfg.CODE_LENGTH).toBe(6);
    expect(cfg.CODE_TTL_SECONDS).toBe(600);
    expect(cfg.MAX_VERIFY_ATTEMPTS).toBe(5);
  });

  it('coerces numeric overrides from strings', () => {
    const cfg = loadConfig({ ...VALID, CODE_LENGTH: '8', CODE_TTL_SECONDS: '300' } as NodeJS.ProcessEnv);
    expect(cfg.CODE_LENGTH).toBe(8);
    expect(cfg.CODE_TTL_SECONDS).toBe(300);
  });

  it('throws when required values are missing', () => {
    expect(() => loadConfig({ TABLE_NAME: 'x' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('throws on an invalid sender email', () => {
    expect(() => loadConfig({ ...VALID, SENDER_EMAIL: 'not-an-email' } as NodeJS.ProcessEnv)).toThrow();
  });
});
