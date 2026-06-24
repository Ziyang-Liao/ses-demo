#!/usr/bin/env bash
# Register an SES email identity for sandbox verification. AWS sends a confirmation link to
# the address; the owner must click it before the address can send or (in sandbox) receive.
#
# Usage: ./scripts/verify-identity.sh <email> [aws-profile] [region]
set -euo pipefail

EMAIL="${1:?Usage: verify-identity.sh <email> [profile] [region]}"
PROFILE="${2:-temp-account}"
REGION="${3:-us-east-1}"

echo "Registering SES identity: ${EMAIL} (profile=${PROFILE}, region=${REGION})"
aws sesv2 create-email-identity \
  --email-identity "${EMAIL}" \
  --profile "${PROFILE}" \
  --region "${REGION}" || true

echo
echo "Current verification status:"
aws sesv2 get-email-identity \
  --email-identity "${EMAIL}" \
  --profile "${PROFILE}" \
  --region "${REGION}" \
  --query '{Verified:VerifiedForSendingStatus}' --output table

echo
echo "ACTION REQUIRED: open the mailbox for ${EMAIL} and click the AWS verification link."
