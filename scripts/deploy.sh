#!/usr/bin/env bash
# Deploy the OTP service to the AUTHORIZED account only.
#
# Usage: ./scripts/deploy.sh <senderEmail> [aws-profile] [region]
#
# The profile defaults to `temp-account` and is pinned on the CLI so deploys can never
# accidentally target a different (e.g. local default) account.
set -euo pipefail

SENDER="${1:?Usage: deploy.sh <senderEmail> [profile] [region]}"
PROFILE="${2:-temp-account}"
REGION="${3:-us-east-1}"

echo "Target account identity for profile '${PROFILE}':"
aws sts get-caller-identity --profile "${PROFILE}" --output table

echo
echo "Deploying OtpServiceStack (sender=${SENDER}, region=${REGION})..."
npx cdk deploy OtpServiceStack \
  -c senderEmail="${SENDER}" \
  --profile "${PROFILE}" \
  --region "${REGION}" \
  --require-approval never
