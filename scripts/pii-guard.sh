#!/usr/bin/env bash
# Secret/PII guard. Scans staged changes for values that must never be committed:
# real email addresses, AWS account IDs, access keys, deployed resource hostnames/ARNs.
#
# Install as a git hook (run once per clone):
#   ln -sf ../../scripts/pii-guard.sh .git/hooks/pre-commit
#
# Or run manually / in CI:  ./scripts/pii-guard.sh
set -euo pipefail

# Compare staged content if invoked as a hook; otherwise scan the whole tree.
# The guard script itself and the lockfile are excluded (the script necessarily
# contains the very patterns it searches for).
EXCLUDE=(':!package-lock.json' ':!scripts/pii-guard.sh')
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  RAW="$(git diff --cached -U0 -- . "${EXCLUDE[@]}" 2>/dev/null || true)"
else
  RAW="$(git diff -U0 -- . "${EXCLUDE[@]}" 2>/dev/null || true)"
fi
# Only inspect ADDED lines (leading '+', excluding the '+++' file header). Removing a
# previously-leaked value should never block a commit; introducing one must.
DIFF="$(echo "$RAW" | grep -E '^\+' | grep -vE '^\+\+\+' || true)"
[ -z "$DIFF" ] && DIFF="$(git grep -nI '' -- . "${EXCLUDE[@]}" 2>/dev/null || true)"

# Patterns that indicate leaked PII / secrets. Generic placeholders (example.com,
# yourdomain.com, <id>) are intentionally NOT matched.
PATTERNS=(
  '[A-Za-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|amazon|icloud)\.com'  # real personal mailboxes
  'AKIA[0-9A-Z]{16}'                                                    # AWS access key id
  'aws_secret_access_key'                                               # secret key marker
  '[0-9]{12}'                                                           # 12-digit AWS account id
  '[a-z0-9]+\.cloudfront\.net'                                          # deployed CloudFront host
  '[a-z0-9]{10}\.execute-api\.'                                         # deployed API host
  'arn:aws:secretsmanager:[^ ]*Pepper'                                  # pepper secret ARN
)

found=0
for p in "${PATTERNS[@]}"; do
  if echo "$DIFF" | grep -nEi "$p" >/dev/null 2>&1; then
    echo "✖ PII/secret guard: matched forbidden pattern: $p" >&2
    echo "$DIFF" | grep -nEi "$p" | head -5 >&2
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo "" >&2
  echo "Commit blocked. Replace real values with placeholders (example.com, <id>) or inject them at runtime." >&2
  exit 1
fi
echo "✓ PII/secret guard passed."
