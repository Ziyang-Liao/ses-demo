import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

/**
 * Serves a minimal single-page UI for exercising the OTP flow from a browser.
 *
 * It is served at `GET /` and calls the API with RELATIVE paths (`/v1/otp/...`), so when it
 * is fronted by CloudFront everything is same-origin and no CORS configuration is needed.
 * No secrets are embedded — the page only ever talks to the public API endpoints.
 */
export const handler = async (
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: PAGE,
  };
};

const PAGE = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Email OTP Demo</title>
  <style>
    :root { --brand:#0b5fff; --bg:#f4f5f7; --ok:#0a7d33; --err:#c0331f; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
           background:var(--bg); color:#1a1a1a; display:flex; min-height:100vh;
           align-items:center; justify-content:center; padding:24px; }
    .card { background:#fff; width:100%; max-width:440px; border-radius:16px;
            box-shadow:0 8px 30px rgba(0,0,0,.08); padding:32px; }
    h1 { font-size:20px; margin:0 0 4px; }
    p.sub { margin:0 0 24px; color:#777; font-size:13px; }
    label { display:block; font-size:13px; font-weight:600; margin:16px 0 6px; }
    input { width:100%; padding:12px 14px; border:1px solid #d9dce1; border-radius:10px;
            font-size:15px; outline:none; }
    input:focus { border-color:var(--brand); }
    button { width:100%; margin-top:20px; padding:13px; border:0; border-radius:10px;
             background:var(--brand); color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    .row { display:flex; gap:10px; }
    .row > * { flex:1; }
    .msg { margin-top:18px; padding:12px 14px; border-radius:10px; font-size:13px;
           display:none; white-space:pre-wrap; word-break:break-word; }
    .msg.ok  { display:block; background:#e8f6ed; color:var(--ok); }
    .msg.err { display:block; background:#fdeceA; color:var(--err); }
    .step { display:none; }
    .step.active { display:block; }
    .hint { font-size:12px; color:#999; margin-top:8px; }
    code { background:#eef3ff; padding:2px 6px; border-radius:6px; font-size:12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>邮箱验证码 Demo</h1>
    <p class="sub">AWS SES · API Gateway · Lambda · DynamoDB · CloudFront</p>

    <div id="step1" class="step active">
      <label for="email">邮箱地址</label>
      <input id="email" type="email" placeholder="you@example.com" autocomplete="email" />
      <button id="sendBtn">发送验证码</button>
      <div class="hint">验证码 6 位，10 分钟内有效，60 秒内不可重发。</div>
    </div>

    <div id="step2" class="step">
      <label for="code">输入收到的验证码</label>
      <div class="row">
        <input id="code" inputmode="numeric" maxlength="6" placeholder="123456" />
        <button id="verifyBtn" style="margin-top:0;">验证</button>
      </div>
      <button id="resetBtn" style="background:#eef0f3;color:#333;">换个邮箱重来</button>
    </div>

    <div id="msg" class="msg"></div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const msg = $('msg');
    function show(kind, text) { msg.className = 'msg ' + kind; msg.textContent = text; }
    function clear() { msg.className = 'msg'; msg.textContent = ''; }

    async function post(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let json = {};
      try { json = await res.json(); } catch (_) {}
      return { status: res.status, json };
    }

    $('sendBtn').addEventListener('click', async () => {
      const email = $('email').value.trim();
      if (!email) { show('err', '请输入邮箱'); return; }
      clear(); $('sendBtn').disabled = true; $('sendBtn').textContent = '发送中…';
      try {
        const { status, json } = await post('/v1/otp/request', { email });
        if (status === 202) {
          show('ok', '验证码已发送，请查收邮箱（含垃圾邮件）。');
          $('step1').classList.remove('active');
          $('step2').classList.add('active');
          $('code').focus();
        } else if (status === 429) {
          show('err', '发送过于频繁，请 ' + (json.retryAfterSeconds || 60) + ' 秒后重试。');
        } else {
          show('err', '发送失败：' + (json.message || ('HTTP ' + status)));
        }
      } catch (e) {
        show('err', '网络错误：' + e.message);
      } finally {
        $('sendBtn').disabled = false; $('sendBtn').textContent = '发送验证码';
      }
    });

    $('verifyBtn').addEventListener('click', async () => {
      const email = $('email').value.trim();
      const code = $('code').value.trim();
      if (!/^[0-9]{4,10}$/.test(code)) { show('err', '请输入收到的数字验证码'); return; }
      clear(); $('verifyBtn').disabled = true;
      try {
        const { status, json } = await post('/v1/otp/verify', { email, code });
        if (status === 200) {
          show('ok', '✅ 验证成功！\\n已签发验证令牌（5 分钟有效）：\\n' + json.verificationToken);
        } else if (status === 401) {
          show('err', '验证码错误，剩余尝试次数：' + json.remainingAttempts);
        } else if (status === 410) {
          show('err', '验证码已过期或已被使用，请重新获取。');
        } else if (status === 429) {
          show('err', '尝试次数过多，验证码已锁定，请重新获取。');
        } else {
          show('err', '验证失败：' + (json.message || ('HTTP ' + status)));
        }
      } catch (e) {
        show('err', '网络错误：' + e.message);
      } finally {
        $('verifyBtn').disabled = false;
      }
    });

    $('resetBtn').addEventListener('click', () => {
      clear(); $('code').value = '';
      $('step2').classList.remove('active');
      $('step1').classList.add('active');
      $('email').focus();
    });
  </script>
</body>
</html>`;
