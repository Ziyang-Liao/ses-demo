#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { OtpServiceStack } from '../lib/otp-service-stack';

const app = new cdk.App();

/**
 * Configuration is supplied at synth/deploy time via CDK context (`-c senderEmail=...`) or
 * environment variables — never hard-coded. No secret values are accepted here; the sender
 * address is non-sensitive operational config.
 */
const senderEmail =
  app.node.tryGetContext('senderEmail') ?? process.env.OTP_SENDER_EMAIL;

if (!senderEmail) {
  throw new Error(
    'Missing sender email. Pass it with `-c senderEmail=you@example.com` or set OTP_SENDER_EMAIL.',
  );
}

new OtpServiceStack(app, 'OtpServiceStack', {
  senderEmail,
  // Deploy into whatever account/region the CLI profile resolves to. The deploy scripts pin
  // this to `--profile temp-account` so it only ever targets the authorized account.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Production-grade email OTP (verification code) service on AWS SES',
  tags: {
    project: 'ses-otp-service',
    'managed-by': 'cdk',
  },
});
