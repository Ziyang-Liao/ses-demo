import {
  SendEmailCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';

/**
 * Sends the verification-code email via SES v2. The sender must be a verified identity
 * (in the SES sandbox the recipient must be verified too).
 */
export class EmailSender {
  private readonly client: SESv2Client;

  constructor(
    private readonly senderEmail: string,
    region: string,
    client?: SESv2Client,
  ) {
    this.client = client ?? new SESv2Client({ region });
  }

  async sendOtp(params: {
    to: string;
    code: string;
    ttlSeconds: number;
    purpose: string;
  }): Promise<string | undefined> {
    const { to, code, ttlSeconds, purpose } = params;
    const minutes = Math.round(ttlSeconds / 60);

    const out = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.senderEmail,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: `Your verification code: ${code}`, Charset: 'UTF-8' },
            Body: {
              Text: { Data: buildText(code, minutes, purpose), Charset: 'UTF-8' },
              Html: { Data: buildHtml(code, minutes, purpose), Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
    return out.MessageId;
  }
}

function buildText(code: string, minutes: number, purpose: string): string {
  return [
    `Your verification code is: ${code}`,
    '',
    `This code is for: ${purpose}.`,
    `It expires in ${minutes} minute(s) and can be used only once.`,
    '',
    'If you did not request this code, you can safely ignore this email.',
  ].join('\n');
}

function buildHtml(code: string, minutes: number, purpose: string): string {
  // Inline styles only — many email clients strip <style> blocks. Code is escaped-safe
  // because it is generated server-side as digits only.
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;">
            <tr><td style="font-size:18px;font-weight:bold;color:#1a1a1a;">Verification code</td></tr>
            <tr><td style="padding:16px 0;color:#555;font-size:14px;">Use the code below to complete your <strong>${purpose}</strong>.</td></tr>
            <tr>
              <td align="center" style="padding:8px 0 16px;">
                <div style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#0b5fff;background:#eef3ff;border-radius:8px;padding:16px 24px;display:inline-block;">${code}</div>
              </td>
            </tr>
            <tr><td style="color:#888;font-size:13px;">This code expires in ${minutes} minute(s) and can be used only once.</td></tr>
            <tr><td style="padding-top:24px;color:#aaa;font-size:12px;border-top:1px solid #eee;">If you did not request this code, you can safely ignore this email.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
