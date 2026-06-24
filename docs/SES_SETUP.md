# Amazon SES — Complete Setup & Operations Guide (start here on a new account)

This guide is for anyone who has a **brand-new AWS account** and needs to enable Amazon SES
from scratch to send email (verification codes, notifications, etc.). It covers, end to end:
prerequisites → identity verification (email / domain) → DKIM / SPF / DMARC → the sandbox →
requesting production access → bounces / complaints / suppression → monitoring → wiring SES
into this project.

> All commands use region `us-east-1` and a CLI profile named `temp-account` as examples.
> Replace them with your actual region / profile. **Never put real keys or account IDs in
> scripts or the repo** — inject them via command-line args or environment variables.

---

## 0. Glossary

| Term | Meaning |
| --- | --- |
| **Identity** | An email address or domain you are authorized to send from. Must be verified before sending. |
| **Sandbox** | The default state of a new account: you can only send to **verified** recipients, with very low quota. |
| **Production access** | Lifts the sandbox: send to any recipient, higher quota. Requested from AWS. |
| **DKIM** | Cryptographically signs mail so receivers can confirm it is unmodified and truly from your domain. |
| **SPF** | Declares which servers are allowed to send on behalf of your domain. |
| **DMARC** | Tells receivers what to do when SPF/DKIM fail to align (`none` / `quarantine` / `reject`). |
| **Custom MAIL FROM** | The envelope-from domain; configuring it lets SPF **align** with your domain. |
| **Suppression list** | Account-level blocklist: addresses that hard-bounced or complained are auto-added; later sends to them are silently dropped. |

---

## 1. Prerequisites (do these right after creating the account)

1. **Pick the region for SES.** SES is regional — identities, configuration, and quotas are
   per-region. Common ones: `us-east-1`, `us-west-2`, `eu-west-1`. **Send from the same region
   where the identity is verified.**
2. **Grant IAM permissions.** The principal (IAM user / role) operating SES needs at least:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow",
         "Action": [
           "ses:GetAccount", "ses:PutAccountDetails",
           "ses:CreateEmailIdentity", "ses:GetEmailIdentity", "ses:ListEmailIdentities",
           "ses:DeleteEmailIdentity", "ses:PutEmailIdentityMailFromAttributes",
           "ses:SendEmail",
           "ses:CreateConfigurationSet", "ses:CreateConfigurationSetEventDestination",
           "ses:ListSuppressedDestinations", "ses:GetSuppressedDestination",
           "ses:DeleteSuppressedDestination"
         ],
         "Resource": "*" }
     ]
   }
   ```
   > In production, narrow `Resource` to specific identity ARNs and constrain `ses:SendEmail`
   > with an `ses:FromAddress` condition (this project does exactly that).
3. **Have a domain ready (strongly recommended).** A domain whose DNS you can edit is the
   prerequisite for reaching the inbox. Email-address identities are fine only for throwaway
   tests (see §3 and §8).
4. **Configure the AWS CLI:**
   ```bash
   aws configure --profile temp-account          # Access Key / Secret / region
   aws sts get-caller-identity --profile temp-account   # confirm the right account
   ```

---

## 2. Inspect the account's current SES state (self-check)

```bash
aws sesv2 get-account --profile temp-account --region us-east-1
```
Fields that matter (example from a real sandbox account):
```json
{
  "ProductionAccessEnabled": false,   // false = still in the sandbox
  "SendingEnabled": true,             // is the account allowed to send at all
  "EnforcementStatus": "HEALTHY",     // HEALTHY / PROBATION / SHUTDOWN
  "SendQuota": { "Max24HourSend": 200.0, "MaxSendRate": 1.0 }
}
```
- `ProductionAccessEnabled=false` → in the sandbox.
- `EnforcementStatus` other than `HEALTHY` → the account is being penalized for high
  bounce/complaint rates and must be remediated first.

---

## 3. Identity option A: email address (fastest, test-only)

```bash
aws sesv2 create-email-identity \
  --email-identity you@example.com \
  --profile temp-account --region us-east-1
```
AWS emails that address a verification link; it becomes usable **only after the link is
clicked**. Check status:
```bash
aws sesv2 get-email-identity --email-identity you@example.com \
  --profile temp-account --region us-east-1 \
  --query 'VerifiedForSendingStatus'
# true = verified
```
⚠️ **Limitation:** an email-address identity cannot do DKIM alignment (observed
`DkimStatus: NOT_STARTED`). Such mail aligns SPF/DKIM to `amazonses.com`, not your domain,
so it is **very likely filed as spam by Gmail and others** (see §8). Use a domain identity for
anything real.

---

## 4. Identity option B: domain + DKIM (recommended for production)

### 4.1 Create the domain identity and enable Easy DKIM

```bash
aws sesv2 create-email-identity \
  --email-identity yourdomain.com \
  --dkim-signing-attributes NextSigningKeyLength=RSA_2048_BIT \
  --profile temp-account --region us-east-1
```
The response includes three DKIM CNAME tokens. Re-fetch them anytime:
```bash
aws sesv2 get-email-identity --email-identity yourdomain.com \
  --profile temp-account --region us-east-1 \
  --query 'DkimAttributes'
```

### 4.2 Add the three CNAME records at your DNS provider

For each token SES returns (`<tokenN>`), add:

| Type | Host (Name) | Value |
| --- | --- | --- |
| CNAME | `<token1>._domainkey.yourdomain.com` | `<token1>.dkim.amazonses.com` |
| CNAME | `<token2>._domainkey.yourdomain.com` | `<token2>.dkim.amazonses.com` |
| CNAME | `<token3>._domainkey.yourdomain.com` | `<token3>.dkim.amazonses.com` |

> If you use Route 53 with the hosted zone in the same account, SES can write these for you;
> otherwise add them manually at your registrar.

Once DNS propagates (minutes to 72h), `DkimAttributes.Status` goes from `PENDING` to `SUCCESS`:
```bash
aws sesv2 get-email-identity --email-identity yourdomain.com \
  --profile temp-account --region us-east-1 \
  --query 'DkimAttributes.Status'    # SUCCESS = DKIM aligned
```
Then send from `From: no-reply@yourdomain.com`; mail carries your domain's valid DKIM signature.

### 4.3 SPF (custom MAIL FROM domain — optional but recommended)

Align SPF with your domain too, further lowering spam likelihood:
```bash
aws sesv2 put-email-identity-mail-from-attributes \
  --email-identity yourdomain.com \
  --mail-from-domain mail.yourdomain.com \
  --behavior-on-mx-failure USE_DEFAULT_VALUE \
  --profile temp-account --region us-east-1
```
Then add to DNS:

| Type | Host | Value |
| --- | --- | --- |
| MX | `mail.yourdomain.com` | `10 feedback-smtp.us-east-1.amazonses.com` |
| TXT | `mail.yourdomain.com` | `"v=spf1 include:amazonses.com ~all"` |

### 4.4 DMARC (recommended)

Add a TXT record. Start with `p=none` to observe, then tighten to `quarantine` / `reject`:

| Type | Host | Value |
| --- | --- | --- |
| TXT | `_dmarc.yourdomain.com` | `"v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com"` |

> ⚠️ Never use someone else's domain that publishes `p=quarantine/reject` (e.g. a big company's
> domain) as your From address — mail will be quarantined outright. Use only a domain **whose
> DNS you control**.

---

## 5. The sandbox: limits and how to test

A new account starts in the sandbox:
- **Recipients must also be verified identities** (both sender and recipient).
- Low quota: roughly **200 emails/day, 1 email/sec** by default (trust the actual
  `get-account` output).
- Good for development; you cannot email the public.

End-to-end test inside the sandbox:
```bash
# Verify both sender and recipient (each clicks the link in their email)
aws sesv2 create-email-identity --email-identity sender@example.com    --profile temp-account --region us-east-1
aws sesv2 create-email-identity --email-identity recipient@example.com --profile temp-account --region us-east-1

# Send a test message
aws sesv2 send-email \
  --from-email-address sender@example.com \
  --destination 'ToAddresses=recipient@example.com' \
  --content '{"Simple":{"Subject":{"Data":"test"},"Body":{"Text":{"Data":"hello"}}}}' \
  --profile temp-account --region us-east-1
```

---

## 6. Request production access (leave the sandbox)

Use the console (SES → Account dashboard → **Request production access**) or the CLI:
```bash
aws sesv2 put-account-details \
  --production-access-enabled \
  --mail-type TRANSACTIONAL \
  --website-url https://yourdomain.com \
  --use-case-description "Transactional email verification codes for sign-in / sign-up. Double opt-in, codes expire in 10 min, bounces + complaints handled via the suppression list." \
  --contact-language EN \
  --additional-contact-email-addresses ops@yourdomain.com \
  --profile temp-account --region us-east-1
```
**Tips to get approved:**
- State the mail type (`TRANSACTIONAL` vs `PROMOTIONAL`).
- Explain the use case, sending volume, and where recipients come from (users who opted in, not
  a purchased list).
- Describe how you handle bounces and complaints (e.g. suppression list + monitoring).
- Provide a real, reachable website / unsubscribe mechanism.

Review is usually within 24 hours. Once approved, `ProductionAccessEnabled` becomes `true`,
quota rises, and you can send to any recipient. For higher quota later, open a "Sending limit
increase" case in the console.

---

## 7. Bounces / complaints / suppression list (operations core)

SES is **very sensitive to bounce and complaint rates**; exceeding thresholds gets you
throttled or stopped:
- Keep the bounce rate < 5% (≈10% is dangerous).
- Keep the complaint rate < 0.1% (≈0.5% is dangerous).

The account-level **suppression list** auto-collects hard-bounce / complaint addresses; later
sends to them are silently dropped:
```bash
# List the suppression list
aws sesv2 list-suppressed-destinations --profile temp-account --region us-east-1
# Check whether an address is suppressed
aws sesv2 get-suppressed-destination --email-address bad@example.com --profile temp-account --region us-east-1
# Remove it once the address is fixed
aws sesv2 delete-suppressed-destination --email-address bad@example.com --profile temp-account --region us-east-1
```
**Best practice:** process bounce/complaint events (via §9 notifications) and stop sending to
invalid addresses promptly.

---

## 8. Delivery troubleshooting: "sent" ≠ "in the inbox"

A `MessageId` from SES only means **SES accepted the request** — not that the recipient's inbox
received it. To investigate, attach a **configuration set + event destination** and read the
real events (`Send` / `Delivery` / `Bounce` / `Reject` / `Complaint`).

```bash
# 1) Create a configuration set
aws sesv2 create-configuration-set --configuration-set-name diag \
  --profile temp-account --region us-east-1

# 2) Add a CloudWatch event destination
aws sesv2 create-configuration-set-event-destination \
  --configuration-set-name diag --event-destination-name cw \
  --event-destination '{"Enabled":true,"MatchingEventTypes":["SEND","DELIVERY","BOUNCE","COMPLAINT","REJECT"],"CloudWatchDestination":{"DimensionConfigurations":[{"DimensionName":"ses:configuration-set","DimensionValueSource":"MESSAGE_TAG","DefaultDimensionValue":"diag"}]}}' \
  --profile temp-account --region us-east-1

# 3) Send using that configuration set, then read the metric
aws cloudwatch get-metric-statistics --namespace AWS/SES --metric-name Delivery \
  --dimensions Name=ses:configuration-set,Value=diag \
  --start-time "$(date -u -d '-20 min' +%FT%T)" --end-time "$(date -u +%FT%T)" \
  --period 1200 --statistics Sum --profile temp-account --region us-east-1
```
**Interpreting results:**
- `Delivery=1` with no `Bounce/Reject` → the recipient's mail server **accepted** it. If the
  user "didn't get it," it most likely went to **Spam / Promotions** → root cause is unaligned
  sender authentication (email-address identity, no domain DKIM) → go back to §4 and set up
  domain DKIM.
- A `Bounce` → invalid or rejected address; check the address and the suppression list.
- A `Reject` → SES judged the content as containing a virus / malformed, etc.

> Delete the temporary diagnostic configuration set when done:
> `aws sesv2 delete-configuration-set --configuration-set-name diag --profile temp-account --region us-east-1`

---

## 9. Monitoring & alerting (required for production)

- **Event notifications:** attach an SNS event destination to the configuration set and push
  Bounce/Complaint events to a Lambda/queue for automatic handling.
- **CloudWatch alarms:** set thresholds on `Reputation.BounceRate` and
  `Reputation.ComplaintRate`.
- **Quota monitoring:** watch `Send` approaching `Max24HourSend`.
- **CloudWatch dashboard:** trend Send / Delivery / Bounce / Complaint together.

---

## 10. New-account SES enablement checklist

- [ ] Pick the region, set up the CLI profile, confirm the account with `get-caller-identity`
- [ ] Grant the operator the minimal usable SES IAM permissions
- [ ] `get-account` to view sandbox state / quota / EnforcementStatus
- [ ] **Verify a domain identity and enable DKIM** (add 3 CNAMEs, wait for `Status=SUCCESS`)
- [ ] Configure custom MAIL FROM (SPF alignment) and DMARC (start with `p=none`)
- [ ] Run an end-to-end test inside the sandbox with a verified recipient
- [ ] Prepare bounce/complaint handling (event notifications + suppression-list workflow)
- [ ] Submit the production-access request, stating use case and compliance measures
- [ ] Configure CloudWatch alarms (bounce rate / complaint rate / quota)
- [ ] After go-live, keep monitoring delivery quality via configuration-set events

---

## 11. Wiring SES into this project (ses-otp-service)

This repo's OTP service needs exactly one thing from SES: **a verified sender identity that
actually delivers.**

1. Verify a domain identity and enable DKIM per §4 (production); or verify an email per §3 (test).
2. At deploy time, inject the sender as a parameter (**never hard-coded**):
   ```bash
   export SENDER_EMAIL="no-reply@yourdomain.com"
   ./scripts/deploy.sh "$SENDER_EMAIL"
   ```
   The stack adds an `ses:FromAddress` condition to `ses:SendEmail`, so the Lambda can only send
   as that sender.
3. If still in the sandbox, the test recipient must also be verified (§5).
4. Troubleshoot delivery per §8; complete the §10 checklist before go-live.

> Related docs: architecture & sequences in [`SOLUTION.md`](SOLUTION.md); deploy & test in the
> root `README.md`. 中文版见 [`SES_SETUP_zh.md`](SES_SETUP_zh.md).
