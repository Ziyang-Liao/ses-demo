#!/usr/bin/env bash
# Tear down the OTP service from the authorized account.
#
# Usage: ./scripts/destroy.sh [senderEmail] [aws-profile] [region]
set -euo pipefail

SENDER="${1:-noreply@example.com}"
PROFILE="${2:-temp-account}"
REGION="${3:-us-east-1}"

npx cdk destroy OtpServiceStack \
  -c senderEmail="${SENDER}" \
  --profile "${PROFILE}" \
  --region "${REGION}" \
  --force
