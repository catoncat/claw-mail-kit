# Cloudflare 版 Claw Mail

这是本地 Claw Mail 的 Cloudflare Worker 版本实现说明。目标是部署一个私有 Web 邮箱应用：外层由 Cloudflare Access 保护，Worker 只暴露 `/api/*` 给已通过 Access 的用户，静态 UI 由 Worker Assets 托管。

## 运行组件

- `wrangler.jsonc`：Worker、Static Assets、D1、Cron 配置。
- `worker/src/`：fetch-only Worker 后端。
  - `auth.ts`：验证 Cloudflare Access JWT；本地开发可用 `DEV_BYPASS_AUTH=true`。
  - `claw-dashboard.ts`：验证码登录、workspace/API key/mailbox 同步、子邮箱和通讯规则接口。
  - `claw-coremail.ts`：Coremail proxy 的 folders/messages/search/read/mark/send/reply。
  - `db.ts`：D1 settings/mailboxes/messages/refresh_state 读写，加密 settings。
  - `refresh.ts`：Cron 和手动刷新共用的轮询服务。
- `worker/public/`：Cloudflare 版 UI。
- `worker/migrations/0001_initial.sql`：D1 初始 schema。
- `research/ClawEmail/`：只做协议参考，已加入 `.gitignore`，不要复制其大段源码进实现。

## Secret / vars

部署级 Secret：

```bash
wrangler secret put APP_ENCRYPTION_KEY
```

生产 Access JWT 校验需要：

```bash
wrangler secret put ACCESS_TEAM_DOMAIN   # 例如 your-team.cloudflareaccess.com
wrangler secret put ACCESS_AUD           # Access Application AUD
```

非 secret vars 在 `wrangler.jsonc`：`CLAW_HOST`、`REFRESH_FOLDERS`、`REFRESH_LIMIT`。

本地开发可复制 `.dev.vars.example` 为 `.dev.vars`，只在本地使用 `DEV_BYPASS_AUTH=true`。

## D1

```bash
wrangler d1 create claw_mail
# 把返回的 database_id 写回 wrangler.jsonc
npm run cf:migrate:local
wrangler d1 migrations apply claw_mail --remote
```

敏感值只存加密后的 D1 settings：`claw.apiKey` 与 `claw.dashboardCookie`。API 响应不回显这些值。

## API

- `GET /api/me`
- `POST /api/claw/send-code`
- `POST /api/claw/verify-code`
- `POST /api/claw/refresh`
- `GET /api/mailboxes`
- `POST /api/mailboxes`
- `POST /api/mailboxes/:id/comm-settings`
- `POST /api/mailboxes/:id/aggregate`
- `DELETE /api/mailboxes/:id`
- `GET /api/folders`
- `GET /api/messages`
- `GET /api/search`
- `GET /api/message`
- `POST /api/mark`
- `POST /api/send`
- `POST /api/reply`

`/api/messages` 和 `/api/search` 读 D1 索引；`/api/message` 按需读正文并缓存；`POST /api/claw/refresh` 与 Cron 使用同一刷新服务。

## 当前部署状态

- Worker：`claw-mail-cloudflare`
- Custom domain：`https://claw.chen.rs/`
- D1：`claw_mail` (`5f95a29f-082b-47c6-9fd1-3099511d4c15`)
- Cron：`*/5 * * * *`，默认索引收件箱/已发送/已删除
- Cloudflare Access：应用 `Claw Mail` 保护 `claw.chen.rs`；允许 `1x02790@gmail.com` 与 `crs0910@icloud.com`。

验证：未登录访问 `/` 和 `/api/me` 会跳转到 `whynotok.cloudflareaccess.com` 的 Access 登录页；这说明请求先经过 Access，再到 Worker。
