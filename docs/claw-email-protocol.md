# Claw 163 agent mail local notes

目标：不用 OpenClaw，也能在本地程序里收发 `@claw.163.com` agent 邮箱。

## 授权链接格式

`https://u.163.com/t1/...` 返回纯文本，每行是冒号分隔：

```text
<name>:<account-id>:<auth-code>
__apikey__:workspace:<ck_live_api_key>
```

- `auth-code` 为空时表示 WebSocket/Coremail Ajax 模式，实际凭证是 `__apikey__` 行里的 `ck_live_...`。
- 邮箱地址为 `<name>@claw.163.com`。
- 本地 `.env` 只需要：

```env
CLAW_USER=<name>@claw.163.com
CLAW_API_KEY=ck_live_xxx
CLAW_HOST=https://claw.163.com
```

## HTTP 读写原理

1. 用 API key 换短效 Coremail access token：

```http
POST https://claw.163.com/claw-api-gateway/open/v1/mail/auth/token
Authorization: Bearer <ck_live_api_key>
Content-Type: application/json

{"uid":"<user>@claw.163.com"}
```

返回 `result.accessToken` 与 `expiresIn`。

2. 用 access token 调 Coremail Ajax proxy：

```http
POST https://claw.163.com/claw-api-gateway/api/coremail/proxy?uid=<user>&func=<coremail-func>
Authorization: Bearer <accessToken>
Content-Type: application/json
```

常用 `func`：

- `mbox:getAllFolders`：列文件夹。
- `mbox:listMessages`：列邮件 metadata。
- `mbox:searchMessages`：搜索。
- `mbox:readMessage`：读正文/信头/附件列表。
- `mbox:compose`：发新邮件（SDK 已封装）。
- `mbox:replyMessage`：回复邮件（SDK 已封装）。

## 实时收信原理

官方 `@clawemail/node-sdk` 会：

1. `POST /open/v1/mail/auth/im-token` 获取 IM token。
2. 连接 `wss://claw.126.net:5210`。
3. 发送 WuKongIM `CONNECT` 二进制包，uid 是邮箱地址的 base64url 编码。
4. 握手阶段做 X25519 DH，推送 payload 用 AES-128-CBC 解密。
5. 邮件通知 payload 是 JSON，`type=3001`，里面有 `mailId`。
6. 用 `mailId` 再走 HTTP `readMessage` 读取邮件。

本仓库的 `cli/clawmail.mjs` 直接使用官方 SDK 的 WS 实现，避免重写二进制协议。

## 本地 Web UI

启动：

```bash
npm run web
# open http://127.0.0.1:8765
```

Web UI 只把 `CLAW_USER` 暴露给浏览器；`CLAW_API_KEY` 保留在本地 Node server 进程里。

页面能力：

- 文件夹和收件箱未读数。
- 左侧是两个互相独立的选择器：
  - 「邮箱范围」：选择 `全部邮箱` 或某一个主/子邮箱。
  - 「邮箱文件夹」：始终显示同一套文件夹；在 `全部邮箱` 下表示聚合所有启用邮箱的该文件夹，在单邮箱下表示该邮箱自己的该文件夹。
- 收件箱列表、搜索、只看未读。
- 读信：正文放在 sandboxed iframe 中渲染，避免第三方邮件 HTML 直接拿到同源权限。
- 写信和回复。
- SSE 事件流 + SDK WebSocket watcher：单邮箱视图按当前选中的邮箱监听新邮件；聚合视图可手动刷新。

## 子邮箱管理

本地 CLI 现在包装了官方 `mail-cli clawemail ...`，但仍从当前 repo 走，不需要全局 `mail-cli`：

```bash
node cli/clawmail.mjs accounts master-user --json
node cli/clawmail.mjs accounts list --json
node cli/clawmail.mjs accounts info --uid agent-demo@claw.163.com --json
node cli/clawmail.mjs accounts create --prefix bot1 --display-name "Bot 1" --type sub --json
node cli/clawmail.mjs accounts profile --uid release-bot@claw.163.com --display-name "New Name" --json
node cli/clawmail.mjs accounts enable --uid release-bot@claw.163.com --json
node cli/clawmail.mjs accounts disable --uid release-bot@claw.163.com --json
node cli/clawmail.mjs accounts delete --uid release-bot@claw.163.com --json
```

注意：`accounts create` 会返回一次性 auth code。本地 CLI/Web 都会把原始创建结果另存到 `.secrets/submailbox-create-*.json`，但它仍只应按一次性凭证处理。

子邮箱列表以 live `accounts list` 为准；Web UI 左下角点击账号即可查看单独邮箱。

## 聚合邮箱视图

Web UI 默认进入「全部邮箱」聚合视图：

- 「邮箱范围」里的「全部邮箱」聚合主邮箱和所有 active 子邮箱。
- 「邮箱文件夹」在聚合视图也始终可用；例如点「已发送」就是所有启用邮箱的已发送聚合。
- 列表按邮件时间倒序合并，每封邮件显示来源邮箱 chip。
- 点击某封聚合邮件时，会按它的来源邮箱读取正文；回复也会用来源邮箱身份回复。
- 点击具体邮箱可切换到单邮箱视图；此时同一套文件夹只作用于该邮箱，并支持实时监听。

API：

```bash
curl 'http://127.0.0.1:8765/api/folders?aggregate=1'
curl 'http://127.0.0.1:8765/api/messages?aggregate=1&fid=1&limit=40&preview=1'
curl 'http://127.0.0.1:8765/api/search?aggregate=1&fid=1&keyword=hello&limit=40&preview=1'
```
