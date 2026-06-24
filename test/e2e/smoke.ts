/**
 * End-to-end smoke test against a LIVE deployment.
 *
 * It drives the request → (manual code entry) → verify flow plus the key negative cases.
 * Run AFTER `cdk deploy`, with the deployed base URL and a verified recipient mailbox:
 *
 *   API_BASE_URL=https://xxxx.execute-api.us-east-1.amazonaws.com/prod \
 *   TEST_EMAIL=you@example.com \
 *   npm run e2e
 *
 * Because the code is delivered by email (never returned by the API), the script pauses for
 * you to paste the code you received. Set OTP_CODE to run non-interactively.
 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const BASE = process.env.API_BASE_URL;
const EMAIL = process.env.TEST_EMAIL;

if (!BASE || !EMAIL) {
  console.error('Set API_BASE_URL and TEST_EMAIL environment variables.');
  process.exit(1);
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: any = undefined;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log(`\n[1] Request a code for ${EMAIL}`);
  const req = await post('/v1/otp/request', { email: EMAIL });
  console.log('   →', req.status, JSON.stringify(req.json));
  assert(req.status === 202, 'request returns 202 sent');

  console.log('\n[2] Resend immediately (expect 429 cooldown)');
  const resend = await post('/v1/otp/request', { email: EMAIL });
  console.log('   →', resend.status, JSON.stringify(resend.json));
  assert(resend.status === 429, 'immediate resend is rate-limited');

  let code = process.env.OTP_CODE;
  if (!code) {
    const rl = readline.createInterface({ input, output });
    code = (await rl.question('\nPaste the code you received by email: ')).trim();
    rl.close();
  }

  console.log('\n[3] Verify with a WRONG code (expect 401 invalid)');
  const wrong = await post('/v1/otp/verify', { email: EMAIL, code: '000000' });
  console.log('   →', wrong.status, JSON.stringify(wrong.json));
  assert(wrong.status === 401, 'wrong code is rejected with remainingAttempts');

  console.log('\n[4] Verify with the CORRECT code (expect 200 verified)');
  const ok = await post('/v1/otp/verify', { email: EMAIL, code });
  console.log('   →', ok.status, JSON.stringify(ok.json));
  assert(ok.status === 200 && ok.json.status === 'verified', 'correct code verifies');
  assert(typeof ok.json.verificationToken === 'string', 'a verification token is issued');

  console.log('\n[5] Reuse the SAME code (expect 410 single-use)');
  const reuse = await post('/v1/otp/verify', { email: EMAIL, code });
  console.log('   →', reuse.status, JSON.stringify(reuse.json));
  assert(reuse.status === 410, 'a consumed code cannot be reused');

  console.log('\nAll end-to-end checks passed. ✅\n');
}

main().catch((err) => {
  console.error('\nE2E FAILED:', err.message);
  process.exit(1);
});
