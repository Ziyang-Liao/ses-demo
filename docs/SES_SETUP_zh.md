# Amazon SES 完整上手与运维指南（新账号必读）

本文面向**拿到一个全新 AWS 账号**、需要从零启用 Amazon SES 来发送邮件（如验证码 / 通知）
的人。内容覆盖：开通前置条件 → 身份验证（邮箱 / 域名）→ DKIM / SPF / DMARC → 沙箱限制
→ 申请生产权限 → 退信/投诉/抑制列表 → 监控告警 → 与本项目对接。

> 所有命令以 `us-east-1` 区域、CLI Profile 名为 `temp-account` 为例。请按你的实际区域 /
> profile 替换。**不要把任何真实密钥、账号 ID 写进脚本或仓库**——用命令行参数或环境变量注入。

---

## 0. 术语速览

| 术语 | 含义 |
| --- | --- |
| **Identity（身份）** | 你被授权用来发信的"邮箱地址"或"域名"。发信前必须验证。 |
| **Sandbox（沙箱）** | 新账号默认状态：只能发给**已验证**的收件人，配额极低。 |
| **Production access（生产权限）** | 解除沙箱：可发给任意收件人，配额提升。需向 AWS 申请。 |
| **DKIM** | 用密钥给邮件签名，收件方据此确认邮件未被篡改、确实来自该域。 |
| **SPF** | 声明"哪些服务器被允许代表本域发信"。 |
| **DMARC** | 告诉收件方"SPF/DKIM 不通过时怎么处理"（none / quarantine / reject）。 |
| **MAIL FROM 域** | 信封发件域；配置自定义 MAIL FROM 可让 SPF 与你的域**对齐**。 |
| **Suppression list（抑制列表）** | 账号级黑名单：曾硬退信/投诉的地址会被自动加入，后续发信被静默丢弃。 |

---

## 1. 前置条件（开新账号后先做）

1. **确认要用 SES 的区域**。SES 是分区域的，身份、配置、配额都按区域独立。常用：
   `us-east-1` / `us-west-2` / `eu-west-1`。**发信区域要和验证身份的区域一致**。
2. **准备 IAM 权限**。操作 SES 的身份（IAM 用户 / 角色）至少需要：
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
   > 生产中应进一步收敛 `Resource` 到具体身份 ARN，并对 `ses:SendEmail` 加
   > `ses:FromAddress` 条件（本项目即如此）。
3. **准备域名（强烈建议）**。能改 DNS 的域名是"邮件能进收件箱"的前提。用邮箱地址身份
   只适合临时测试（见 §3、§8）。
4. **配置 AWS CLI**：
   ```bash
   aws configure --profile temp-account      # 填 Access Key / Secret / region
   aws sts get-caller-identity --profile temp-account   # 确认账号正确
   ```

---

## 2. 查看账号当前 SES 状态（自查）

```bash
aws sesv2 get-account --profile temp-account --region us-east-1
```
关注字段（本账号实测示例）：
```json
{
  "ProductionAccessEnabled": false,   // false = 仍在沙箱
  "SendingEnabled": true,             // 账号是否被允许发信
  "EnforcementStatus": "HEALTHY",     // HEALTHY / PROBATION / SHUTDOWN
  "SendQuota": { "Max24HourSend": 200.0, "MaxSendRate": 1.0 }
}
```
- `ProductionAccessEnabled=false` → 沙箱中。
- `EnforcementStatus` 不是 `HEALTHY` → 账号因退信/投诉率过高被处罚，需先整改。

---

## 3. 身份验证方式一：邮箱地址（最快，仅适合测试）

```bash
aws sesv2 create-email-identity \
  --email-identity you@example.com \
  --profile temp-account --region us-east-1
```
AWS 会给该邮箱发一封"验证链接"邮件，**点击链接后**才生效。查询状态：
```bash
aws sesv2 get-email-identity --email-identity you@example.com \
  --profile temp-account --region us-east-1 \
  --query 'VerifiedForSendingStatus'
# true = 已验证
```
⚠️ **局限**：邮箱地址身份无法做 DKIM 对齐（实测 `DkimStatus: NOT_STARTED`）。这类邮件
SPF/DKIM 对齐到 `amazonses.com` 而非你的域，**大概率被 Gmail 等判为垃圾邮件**（详见 §8）。
正式环境务必用域名身份。

---

## 4. 身份验证方式二：域名 + DKIM（生产推荐）

### 4.1 创建域名身份并启用 Easy DKIM

```bash
aws sesv2 create-email-identity \
  --email-identity yourdomain.com \
  --dkim-signing-attributes NextSigningKeyLength=RSA_2048_BIT \
  --profile temp-account --region us-east-1
```
返回里会包含 3 个 DKIM CNAME 记录的 token。随时可再查：
```bash
aws sesv2 get-email-identity --email-identity yourdomain.com \
  --profile temp-account --region us-east-1 \
  --query 'DkimAttributes'
```

### 4.2 在你的 DNS 服务商添加 3 条 CNAME

SES 给的每个 token 形如 `<token>`，需添加：

| 记录类型 | 主机名（Name） | 值（Value） |
| --- | --- | --- |
| CNAME | `<token1>._domainkey.yourdomain.com` | `<token1>.dkim.amazonses.com` |
| CNAME | `<token2>._domainkey.yourdomain.com` | `<token2>.dkim.amazonses.com` |
| CNAME | `<token3>._domainkey.yourdomain.com` | `<token3>.dkim.amazonses.com` |

> 若用 Route 53 且托管区在同账号，可让 SES 自动写入；否则手动在域名商处添加。

DNS 生效后（几分钟到 72 小时），`DkimAttributes.Status` 会从 `PENDING` 变 `SUCCESS`：
```bash
aws sesv2 get-email-identity --email-identity yourdomain.com \
  --profile temp-account --region us-east-1 \
  --query 'DkimAttributes.Status'    # SUCCESS = DKIM 已对齐
```
之后用 `From: no-reply@yourdomain.com` 发信即可，邮件带你域的合法 DKIM 签名。

### 4.3 SPF（自定义 MAIL FROM 域，可选但推荐）

让 SPF 也与你的域对齐，进一步降低进垃圾箱概率：
```bash
aws sesv2 put-email-identity-mail-from-attributes \
  --email-identity yourdomain.com \
  --mail-from-domain mail.yourdomain.com \
  --behavior-on-mx-failure USE_DEFAULT_VALUE \
  --profile temp-account --region us-east-1
```
然后在 DNS 添加：

| 记录类型 | 主机名 | 值 |
| --- | --- | --- |
| MX | `mail.yourdomain.com` | `10 feedback-smtp.us-east-1.amazonses.com` |
| TXT | `mail.yourdomain.com` | `"v=spf1 include:amazonses.com ~all"` |

### 4.4 DMARC（建议）

在 DNS 添加一条 TXT，先用 `p=none` 观察，稳定后再收紧到 `quarantine` / `reject`：

| 记录类型 | 主机名 | 值 |
| --- | --- | --- |
| TXT | `_dmarc.yourdomain.com` | `"v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com"` |

> ⚠️ 切勿用别人的、设了 `p=quarantine/reject` 的域（如大公司域）当发件人——本项目早期用
> `@amazon.com` 发信即被 Gmail 直接隔离。只能用**你自己控制 DNS** 的域。

---

## 5. 沙箱（Sandbox）：限制与测试方法

新账号默认在沙箱，规则：
- **收件人也必须是已验证身份**（发件人和收件人都要验证）。
- 配额低：默认约 **200 封/天、1 封/秒**（以 `get-account` 实际返回为准）。
- 适合开发联调，不能对外发。

沙箱内做端到端测试：
```bash
# 同时验证发件人和收件人（各自点邮件里的链接）
aws sesv2 create-email-identity --email-identity sender@example.com   --profile temp-account --region us-east-1
aws sesv2 create-email-identity --email-identity recipient@example.com --profile temp-account --region us-east-1

# 发一封测试信
aws sesv2 send-email \
  --from-email-address sender@example.com \
  --destination 'ToAddresses=recipient@example.com' \
  --content '{"Simple":{"Subject":{"Data":"test"},"Body":{"Text":{"Data":"hello"}}}}' \
  --profile temp-account --region us-east-1
```

---

## 6. 申请生产权限（解除沙箱）

可在控制台（SES → Account dashboard → **Request production access**）或用 CLI：
```bash
aws sesv2 put-account-details \
  --production-access-enabled \
  --mail-type TRANSACTIONAL \
  --website-url https://yourdomain.com \
  --use-case-description "Transactional email verification codes for sign-in / sign-up. Double opt-in, codes expire in 10 min, bounce+complaint handled via suppression list." \
  --contact-language EN \
  --additional-contact-email-addresses ops@yourdomain.com \
  --profile temp-account --region us-east-1
```
**申请要点（提高通过率）**：
- 说明邮件类型（事务性 `TRANSACTIONAL` vs 营销 `PROMOTIONAL`）。
- 说清用途、发送频率、收件人来源（用户主动注册，非买来的名单）。
- 说明你如何处理退信和投诉（如本项目：抑制列表 + 监控）。
- 提供真实可访问的网站 / 退订机制。

审核通常 24 小时内。通过后 `ProductionAccessEnabled` 变 `true`，配额提升，可发任意收件人。
后续如需更高配额，控制台可提"Sending limit increase"工单。

---

## 7. 退信 / 投诉 / 抑制列表（运维核心）

SES 对**退信率（Bounce）和投诉率（Complaint）非常敏感**，超阈值会被降级甚至停发：
- 退信率建议 < 5%（接近 10% 危险）。
- 投诉率建议 < 0.1%（接近 0.5% 危险）。

账号级**抑制列表**会自动收录硬退信 / 投诉地址，之后发给它们会被静默丢弃：
```bash
# 查看抑制列表
aws sesv2 list-suppressed-destinations --profile temp-account --region us-east-1
# 查某地址是否被抑制
aws sesv2 get-suppressed-destination --email-address bad@example.com --profile temp-account --region us-east-1
# 确认地址已修复后移除
aws sesv2 delete-suppressed-destination --email-address bad@example.com --profile temp-account --region us-east-1
```
**最佳实践**：实现退信/投诉处理（通过 §9 的事件通知），及时停止向无效地址发送。

---

## 8. 投递排查：发出去了≠进收件箱

SES 返回 `MessageId` 只代表**SES 接受了请求**，不代表对方收件箱收到。排查方法是开启
**配置集 + 事件目标**，看真实事件（`Send` / `Delivery` / `Bounce` / `Reject` / `Complaint`）。

```bash
# 1) 建配置集
aws sesv2 create-configuration-set --configuration-set-name diag \
  --profile temp-account --region us-east-1

# 2) 加 CloudWatch 事件目标
aws sesv2 create-configuration-set-event-destination \
  --configuration-set-name diag --event-destination-name cw \
  --event-destination '{"Enabled":true,"MatchingEventTypes":["SEND","DELIVERY","BOUNCE","COMPLAINT","REJECT"],"CloudWatchDestination":{"DimensionConfigurations":[{"DimensionName":"ses:configuration-set","DimensionValueSource":"MESSAGE_TAG","DefaultDimensionValue":"diag"}]}}' \
  --profile temp-account --region us-east-1

# 3) 用该配置集发信，再读指标
aws cloudwatch get-metric-statistics --namespace AWS/SES --metric-name Delivery \
  --dimensions Name=ses:configuration-set,Value=diag \
  --start-time "$(date -u -d '-20 min' +%FT%T)" --end-time "$(date -u +%FT%T)" \
  --period 1200 --statistics Sum --profile temp-account --region us-east-1
```
**判读**：
- `Delivery=1` 且无 `Bounce/Reject` → 对方邮件服务器**已接收**。若用户"没收到"，多半进了
  **垃圾邮件 / 促销** 文件夹 → 根因是发件认证不对齐（用邮箱身份，无域 DKIM）→ 回到 §4 配域名 DKIM。
- 有 `Bounce` → 地址无效或被拒，检查地址、是否在抑制列表。
- 有 `Reject` → 内容被 SES 判为含病毒/格式错误等。

> 排障用的临时配置集，用完记得删：
> `aws sesv2 delete-configuration-set --configuration-set-name diag --profile temp-account --region us-east-1`

---

## 9. 监控与告警（生产必备）

- **事件通知**：给配置集挂 SNS 事件目标，把 Bounce/Complaint 推给一个 Lambda/队列自动处理。
- **CloudWatch 告警**：对 `Reputation.BounceRate`、`Reputation.ComplaintRate` 设阈值告警。
- **配额监控**：关注 `Send` 接近 `Max24HourSend`。
- **CloudWatch 仪表盘**：汇总 Send / Delivery / Bounce / Complaint 趋势。

---

## 10. 新账号启用 SES「检查清单」

- [ ] 选定区域，配好 CLI profile，`get-caller-identity` 确认账号
- [ ] 赋予操作者最小可用的 SES IAM 权限
- [ ] `get-account` 查看沙箱状态 / 配额 / EnforcementStatus
- [ ] **验证域名身份并启用 DKIM**（加 3 条 CNAME，等 `Status=SUCCESS`）
- [ ] 配置自定义 MAIL FROM（SPF 对齐）与 DMARC（先 `p=none`）
- [ ] 沙箱内用已验证收件人做端到端测试
- [ ] 准备退信/投诉处理（事件通知 + 抑制列表流程）
- [ ] 提交生产权限申请，说清用途与合规措施
- [ ] 配置 CloudWatch 告警（退信率 / 投诉率 / 配额）
- [ ] 上线后用配置集事件持续监控投递质量

---

## 11. 与本项目（ses-otp-service）对接

本仓库的验证码服务对 SES 的唯一要求是：**一个已验证、且能正常投递的发件人身份**。

1. 按 §4 验证好你的域名身份并启用 DKIM（生产）；或按 §3 验证邮箱（仅测试）。
2. 部署时把发件人作为参数注入（**不写进代码**）：
   ```bash
   export SENDER_EMAIL="no-reply@yourdomain.com"
   ./scripts/deploy.sh "$SENDER_EMAIL"
   ```
   栈内对 `ses:SendEmail` 加了 `ses:FromAddress` 条件，Lambda 只能以该发件人发信。
3. 若仍在沙箱，测试收件人也要先验证（§5）。
4. 投递异常按 §8 排查；上线前完成 §10 清单。

> 相关文档：架构与时序见 [`SOLUTION.md`](SOLUTION.md)；部署与测试见根目录 `README.md`。
> English version: [`SES_SETUP.md`](SES_SETUP.md).
