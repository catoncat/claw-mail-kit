# @clawemail/node-sdk

Claw Email 官方 Node.js SDK，让第三方应用以编程方式**读信**、**写信**和**实时监听新邮件**。

[![npm version](https://img.shields.io/npm/v/@clawemail/node-sdk.svg)](https://www.npmjs.com/package/@clawemail/node-sdk)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

## 安装

```bash
npm install @clawemail/node-sdk
```

## 快速上手

```ts
import { MailClient } from '@clawemail/node-sdk';

const client = new MailClient({
  apiKey: 'ck_live_xxxxxxxxxxxxxxxx',
  user:   'bot@claw.163.com',
});

// 读取一封邮件
const mail = await client.mail.read({ id: 'msg123' });
console.log(mail.subject, mail.from);

// 回复
await client.mail.reply({ id: 'msg123', body: '收到，稍后处理。' });

// 实时监听新邮件
client.ws.onMessage(async ({ mailId }) => {
  const mail = await client.mail.read({ id: mailId, markRead: true });
  console.log('新邮件:', mail.subject);
});
await client.ws.connect();
```

## 初始化

```ts
const client = new MailClient(options);
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `apiKey` | `string` | ✓ | Claw API Key（`ck_live_...`） |
| `user` | `string` | ✓ | 邮箱地址，如 `bot@claw.163.com` |
| `timeout` | `number` | — | HTTP 请求超时（毫秒），默认 `15000` |
| `logger` | `WsLogger \| null` | — | WebSocket 连接日志，默认输出到 `console`；传 `null` 静默 |
| `wsUrl` | `string` | — | 覆盖 WuKongIM WebSocket 地址，默认 `wss://claw.126.net:5210` |

> Access Token 在首次 API 调用时自动获取，过期后自动刷新，无需手动管理。

---

## 读信

### `client.mail.read(opts)`

读取邮件正文、信头及附件列表。

```ts
const mail = await client.mail.read({
  id:       'msg123',   // 必填：邮件 ID
  markRead: true,       // 可选：同时标记为已读，默认 false
});
```

**返回 `MailDetail`：**

```ts
interface MailDetail {
  id:         string;
  from?:      string[];
  to?:        string[];
  cc?:        string[];
  bcc?:       string[];
  subject?:   string;
  date?:      string;        // ISO 日期字符串
  priority?:  number;        // 1 = 最高优先级
  headerRaw?: string;        // 原始 RFC 5322 信头
  html?:      { content: string };  // HTML 正文
  text?:      { content: string };  // 纯文本正文
  attachments?: AttachmentMeta[];
}
```

**示例：**

```ts
const mail = await client.mail.read({ id: 'msg123' });

// 读取正文
console.log(mail.html?.content);

// 读取原始信头（From / Message-ID / X-Mailer 等）
console.log(mail.headerRaw);

// 查看附件列表
for (const att of mail.attachments ?? []) {
  console.log(att.filename, att.contentType, att.size);
}
```

---

### `client.mail.getAttachment(opts)`

下载附件，返回 `AttachmentResponse`，支持三种消费方式。

```ts
const att = await client.mail.getAttachment({
  id:   'msg123',   // 邮件 ID
  part: '2',        // 附件 part ID（来自 mail.attachments[].id）
});
```

**`AttachmentResponse` 的三种用法：**

```ts
// 1. 写入文件（推荐大文件使用，流式传输，不占用大量内存）
await att.writeFile('./report.pdf');

// 2. 取得 Node.js Readable，自由 pipe
import fs from 'node:fs';
att.stream().pipe(fs.createWriteStream('./report.pdf'));

// 3. 取得完整 Buffer
const buf = await att.buffer();
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `att.filename` | `string` | 文件名 |
| `att.contentType` | `string` | MIME 类型 |
| `att.size` | `number \| undefined` | 文件大小（字节） |

> 流只能消费一次。调用 `stream()` / `buffer()` / `writeFile()` 后再次调用会抛出错误。

---

## 写信

### `client.mail.send(opts)`

发送新邮件。

```ts
await client.mail.send({
  to:      ['alice@example.com', 'bob@example.com'],
  subject: '季度报告',
  body:    '请查收附件中的报告。',
});
```

**完整参数：**

```ts
await client.mail.send({
  to:       ['a@example.com'],   // 必填：收件人列表
  subject:  '主题',
  body:     '<h1>你好</h1>',      // 邮件正文
  html:     true,                 // body 是否为 HTML，默认 false
  cc:       ['c@example.com'],
  bcc:      ['d@example.com'],
  priority: 1,                    // 1–5，1 最高，默认 3
  attachments: [
    { filename: 'report.pdf', path: './report.pdf' },
    { filename: 'data.csv',   path: './data.csv', contentType: 'text/csv' },
  ],
});
```

**返回 `SendResult`：**

```ts
{ status: 'sent' }
```

---

### `client.mail.reply(opts)`

回复已有邮件，自动保持邮件线索。

```ts
await client.mail.reply({
  id:   'msg123',       // 必填：原邮件 ID
  body: '收到，谢谢！',
});
```

**完整参数：**

```ts
await client.mail.reply({
  id:     'msg123',
  body:   '请查收附件。',
  html:   false,
  toAll:  true,          // 回复全部收件人，默认 false（仅回复发件人）
  cc:     ['manager@example.com'],
  attachments: [
    { filename: 'doc.pdf', path: './doc.pdf' },
  ],
});
```

---

## 实时推送

`client.ws` 通过 WuKongIM 长连接接收服务端推送，每收到新邮件即触发回调，无需轮询。

连接建立时 SDK 会自动完成 **X25519 DH 密钥协商**，后续消息通过 **AES-128-CBC** 加密传输，无需任何额外配置。

### 基本用法

```ts
// 注册消息处理器（在 connect 之前调用）
client.ws.onMessage(async ({ mailId }) => {
  // mailId 可直接传给 client.mail.read()
  const mail = await client.mail.read({ id: mailId, markRead: true });
  console.log(`新邮件 | 来自: ${mail.from?.[0]} | 主题: ${mail.subject}`);
});

// 注册断线处理器（可选）
client.ws.onDisconnect((reason) => {
  console.warn('WebSocket 断开:', reason);
});

// 建立连接（Token 由 SDK 自动获取，无需手动传入）
await client.ws.connect();
```

### API

| 方法 | 签名 | 说明 |
|------|------|------|
| `connect` | `() => Promise<void>` | 建立 WuKongIM 连接并完成加密握手；失败时抛出 `MailSdkError` |
| `disconnect` | `() => void` | 主动断开连接并清理资源 |
| `isConnected` | `() => boolean` | 返回当前连接状态 |
| `onMessage` | `(handler: (event: MailPushEvent) => void) => void` | 注册新邮件回调 |
| `onDisconnect` | `(handler: (reason: string) => void) => void` | 注册断线回调，`reason` 为描述字符串 |

### `MailPushEvent`

```ts
interface MailPushEvent {
  /** Coremail 消息 ID，可直接传给 client.mail.read(id) */
  mailId: string;
}
```

### 断线重连

`WsResource` 本身不自动重连——断线后触发 `onDisconnect`，由调用方决定策略。
以下是一个带指数退避的重连参考实现：

```ts
const BACKOFF = [1000, 2000, 4000, 8000, 16000];
let retries = 0;

async function connectWithRetry() {
  try {
    await client.ws.connect();
    retries = 0;
  } catch {
    if (retries >= BACKOFF.length) throw new Error('无法连接，已达最大重试次数');
    await new Promise(r => setTimeout(r, BACKOFF[retries++]));
    await connectWithRetry();
  }
}

client.ws.onDisconnect(async () => {
  await connectWithRetry();
});

await connectWithRetry();
```

### 自定义 Logger

`logger` 选项兼容 winston / pino 等主流日志库接口：

```ts
const client = new MailClient({
  apiKey: 'ck_live_xxx',
  user:   'bot@claw.163.com',
  logger: {
    info:  (msg, meta) => myLogger.info(msg, meta),
    warn:  (msg, meta) => myLogger.warn(msg, meta),
    error: (msg, meta) => myLogger.error(msg, meta),
  },
  // 或传 null 完全静默
  // logger: null,
});
```

---

## 错误处理

所有方法在出错时抛出 `MailSdkError`。

```ts
import { MailClient, MailSdkError } from '@clawemail/node-sdk';

try {
  await client.mail.read({ id: 'nonexistent' });
} catch (e) {
  if (e instanceof MailSdkError) {
    console.log(e.code);          // 语义错误码，见下表
    console.log(e.message);       // 人类可读的英文描述
    console.log(e.originalCode);  // 原始 Coremail 错误码（调试用）
    console.log(e.detail);        // 附加调试信息
  }
}
```

**`MailSdkErrorCode` 错误码：**

| 错误码 | 含义 | 常见原因 |
|--------|------|----------|
| `AUTH_FAILED` | 认证失败 | API Key 无效或已过期；WuKongIM Token 无法获取 |
| `PERMISSION_DENIED` | 无权限 | 操作被服务端拒绝 |
| `NOT_FOUND` | 资源不存在 | 邮件 ID 或附件 part ID 不存在 |
| `INVALID_INPUT` | 参数错误 | 收件人为空、地址格式错误等 |
| `RATE_LIMITED` | 超出服务端限制 | 请求过于频繁或超出配额 |
| `SERVER_ERROR` | 服务端错误 | Coremail 内部错误 |
| `NETWORK_ERROR` | 网络错误 | 超时、连接失败 |
| `UNKNOWN` | 未知错误 | 其他未映射的错误 |

---

## 获取 Access Token

如需直接使用短效 Access Token（例如传给前端或其他服务），可调用 `getAccessToken()`。

```ts
const { token, expiresAt } = await client.getAccessToken();

console.log(token);                               // eyJhbGci...（JWT 字符串）
console.log(new Date(expiresAt).toISOString());  // 过期时间
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `token` | `string` | JWT Access Token |
| `expiresAt` | `number` | 过期时间戳（毫秒），可用 `Date.now() < expiresAt` 判断是否有效 |

**缓存行为：**
- Token 缓存在**进程内存**中，同一 `MailClient` 实例多次调用会复用缓存，不重复发起请求
- 进程退出即失效，重新创建 `MailClient` 后首次调用会重新获取
- 多实例部署时各进程独立缓存，不共享

---

## TypeScript 支持

SDK 使用 TypeScript 编写并导出完整类型声明，无需安装 `@types/*`。

```ts
import type {
  MailClientOptions,
  MailDetail,
  AttachmentMeta,
  SendMailOptions,
  ReplyMailOptions,
  GetAttachmentOptions,
  SendResult,
  AccessToken,
  WsLogger,
  MailPushEvent,
} from '@clawemail/node-sdk';

import { WsResource } from '@clawemail/node-sdk';
```

---

## CommonJS 用法

```js
const { MailClient, MailSdkError } = require('@clawemail/node-sdk');

const client = new MailClient({
  apiKey: 'ck_live_xxx',
  user:   'bot@claw.163.com',
});
```

---

## 完整示例

### 自动回复机器人

```ts
import { MailClient, MailSdkError } from '@clawemail/node-sdk';

const client = new MailClient({
  apiKey: process.env.CLAW_API_KEY!,
  user:   process.env.CLAW_USER!,
});

const BACKOFF = [1000, 2000, 4000, 8000, 16000];
let retries = 0;

client.ws.onMessage(async ({ mailId }) => {
  try {
    const mail = await client.mail.read({ id: mailId, markRead: true });

    console.log(`新邮件 | 来自: ${mail.from?.[0]} | 主题: ${mail.subject}`);

    // 下载第一个附件
    if (mail.attachments?.length) {
      const att = await client.mail.getAttachment({
        id: mailId, part: mail.attachments[0].id,
      });
      await att.writeFile(`./${att.filename}`);
      console.log(`附件已保存: ${att.filename}`);
    }

    // 自动回复
    await client.mail.reply({
      id:   mailId,
      body: `您好，\n\n已收到您的邮件「${mail.subject}」，我们将尽快处理。`,
    });
  } catch (e) {
    if (e instanceof MailSdkError) {
      console.error(`[${e.code}] ${e.message}`);
    }
  }
});

client.ws.onDisconnect(async (reason) => {
  console.warn('断线:', reason);
  if (retries < BACKOFF.length) {
    await new Promise(r => setTimeout(r, BACKOFF[retries++]));
    await client.ws.connect();
    retries = 0;
  }
});

await client.ws.connect();
console.log('机器人已启动，等待新邮件...');
```
