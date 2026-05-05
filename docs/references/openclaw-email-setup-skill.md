---
name: claw-email-setup
version: 0.3.1
description: "OpenClaw Email Channel 安装与配置。当用户提供 auth-url、安装链接，或要求安装/配置/检查 OpenClaw 邮件频道时触发。Trigger when: user provides auth-url, install link, npx @clawemail/claw-setup command, or asks to install/configure/check OpenClaw email channel. Covers: one-click install, guided setup, status check, troubleshooting delegation to email-diagnose skill."
homepage: https://claw.163.com
---

# OpenClaw Email Channel Setup

本技能用于安装和配置 OpenClaw 邮件频道插件。请根据下方场景判断树选择对应操作，逐步引导用户完成安装或故障排查。

安装本技能：
```bash
mkdir -p ~/.openclaw/skills/claw-email-setup && curl -sL https://claw.163.com/skills-hub/skills/claw-email-setup -o ~/.openclaw/skills/claw-email-setup/SKILL.md
```

---

## 场景判断

根据用户的描述，判断属于哪个场景，然后按对应步骤执行。

---

### 场景 1: 用户提供了 auth-url（一键安装）

用户粘贴了一个授权链接（形如 `https://u.163.com/xxx` 或短码 `t1/xxxxxxxxxx`），或者粘贴了包含 `--auth-url` 的完整命令。

**步骤：**

1. 运行一键安装命令（将 `<auth-url>` 替换为用户提供的内容）：

   ```bash
   npx "@clawemail/claw-setup@latest" --auth-url "<auth-url>" --skip-restart
   ```

2. **若命令因网络失败**（错误含 `ETIMEDOUT` / `ECONNREFUSED` / `ENOTFOUND` / `fetch failed` / `408` / `timeout` / `network` / `socket hang up`），使用国内镜像重试（`--registry` 仅影响当次命令，不会修改全局配置）：

   ```bash
   npx --registry https://registry.npmmirror.com "@clawemail/claw-setup@latest" --auth-url "<auth-url>" --skip-restart
   ```

> ℹ️ auth-url 支持两种格式：完整链接（`https://u.163.com/xxx`）或短码（以 `t1/` 开头，如 `t1/AbCdEf123456`）。setup 脚本会自动将非 http 开头的值补全为 `https://u.163.com/<值>`。

3. 脚本执行完成后，先根据脚本输出向用户总结当前进度（插件是否更新、账号是否添加成功、mail-cli 状态等），然后检查是否需要重启：

   **若脚本输出包含** `"需要手动执行: openclaw gateway restart"`：告知用户「接下来需要重启 Gateway 来生效变更，重启期间邮件服务会短暂中断约 5-10 秒」，然后执行：

   ```bash
   openclaw gateway restart
   ```

   **若脚本未输出此提示**：说明插件已是最新版本，无需重启，直接进入下一步。

4. 执行 **安装后验证**（见 `## 安装后验证` 节），并将验证结果输出给用户。

5. 同时为用户安装 email-diagnose 诊断技能（方便后续排查）：

   ```bash
   npx skills add https://claw.163.com/skills-hub --skill email-diagnose -a openclaw -g -y
   ```

> ⚠️ auth-url 有效期 30 分钟，有效期内可重复使用。过期后需重新获取。

> ⚠️ **注意**：安装脚本会在核心步骤完成后尝试执行 `mail-cli` 安装和认证（延迟可选步骤）。mail-cli 步骤使用 `runOptionalStep` 执行，失败**不会导致脚本退出**，仅输出警告。mail-cli 失败不影响插件核心功能（邮件收发），仅影响 CLI 邮件发送工具。

---

### 场景 2: 没有 auth-url，但要完整安装

用户希望安装，但没有提供 auth-url。

**步骤：**

1. 询问用户以下信息：
   - **name**：邮箱前缀（如 `alice`，最终邮箱为 `alice@claw.163.com`；多账号场景如 `alice.work`，最终邮箱为 `alice.work@claw.163.com`）
   - **apikey**：API Key（WebSocket 账号凭证，形如 `ck_live_xxx`）

   > **account-id 自动推导规则**：若 name 不含 `.`（如 `alice`），account-id 为 `default`；若 name 含 `.`（如 `alice.work`），account-id 取最后一个 `.` 之后的部分（即 `work`）。

2. 获取信息后，运行完整安装命令（`<account-id>` 按上述规则推导）：

   ```bash
   npx "@clawemail/claw-setup@latest" --all \
     --name "<name>" \
     --account-id "<account-id>" \
     --apikey "<apikey>" \
     --skip-restart
   ```

3. **若命令因网络失败**，切换镜像后重试（见 `## 错误处理策略`）。

4. 脚本执行完成后，先根据脚本输出向用户总结当前进度（插件是否更新、账号是否添加成功等），然后检查是否需要重启：

   **若脚本输出包含** `"需要手动执行: openclaw gateway restart"`：告知用户「接下来需要重启 Gateway 来生效变更，重启期间邮件服务会短暂中断约 5-10 秒」，然后执行：

   ```bash
   openclaw gateway restart
   ```

   **若脚本未输出此提示**：说明插件已是最新版本，无需重启，直接进入下一步。

5. 命令完成后，执行 **安装后验证**（见 `## 安装后验证` 节），并将验证结果输出给用户。

---

### 场景 3: 仅安装/更新插件

用户只需安装或更新邮件插件，无需重新配置账号。

**步骤：**

1. 运行插件安装/更新命令：

   ```bash
   npx "@clawemail/claw-setup@latest" --install --skip-restart
   ```

> ⚠️ `--install` 模式仅安装/更新插件，不配置账号。若同时提供了 `--apikey`，会额外执行 mail-cli 设置（可选，失败不影响）。

2. **若命令因网络失败**，切换镜像后重试（见 `## 错误处理策略`）。

3. 脚本执行完成后，先根据脚本输出向用户总结结果（插件是否更新等），然后检查是否需要重启：

   **若脚本输出包含** `"需要手动执行: openclaw gateway restart"`：告知用户「接下来需要重启 Gateway 来生效变更，重启期间邮件服务会短暂中断约 5-10 秒」，然后执行：

   ```bash
   openclaw gateway restart
   ```

   **若脚本未输出此提示**：说明插件已是最新版本，无需重启，直接告知用户。

4. 命令完成后，验证插件是否已更新：

   ```bash
   openclaw plugins list
   ```

---

### 场景 4: 添加更多邮箱账号

用户已完成基础安装，需要添加额外的邮箱账号。

**步骤：**

1. 询问用户以下信息：
   - **name**：邮箱前缀（如 `bob`，最终邮箱为 `bob@claw.163.com`；多账号如 `bob.work`）
   - **apikey**：API Key（WebSocket 账号凭证，形如 `ck_live_xxx`）

   > **account-id 自动推导**：同场景 2 规则（无 `.` → `default`，有 `.` → 取末段）。

2. 运行添加账号命令（`<account-id>` 按规则推导）：

   ```bash
   npx "@clawemail/claw-setup@latest" --account \
     --name "<name>" \
     --account-id "<account-id>" \
     --apikey "<apikey>"
   ```

3. 脚本执行完成后，根据脚本输出检查是否需要重启：

   **若脚本输出包含** `"需要手动执行: openclaw gateway restart"`：告知用户「接下来需要重启 Gateway 来生效配置，重启期间邮件服务会短暂中断约 5-10 秒」，然后执行：

   ```bash
   openclaw gateway restart
   ```

   **若脚本未输出此提示**：说明无需重启（default 账号的 channel 变更支持热加载）。

> ℹ️ 非默认账号（如 `work`）首次绑定时会新增 agent binding，binding 变更需要重启 Gateway 才能生效。default 账号跳过绑定步骤，channel 变更支持热加载，无需重启。

---

### 场景 5: 检查状态

用户想确认插件是否正常运行。

**步骤：**

1. 检查插件列表：

   ```bash
   openclaw plugins list
   ```

2. 检查频道状态：

   ```bash
   openclaw channels status --json
   ```

3. 查看最新日志：

   ```bash
   openclaw logs --limit 20
   ```

4. 将结果汇总展示给用户，按 `## 安装后验证` 格式输出。

---

### 场景 6: 出了问题 / 排查故障

用户反馈邮件收发异常、连接失败、回复不到等问题。

**步骤：**

1. 先查看最近日志，初步判断错误类型：

   ```bash
   openclaw logs --limit 50
   ```

2. 直接运行安装命令（已安装时会自动跳过）：

   ```bash
   npx skills add https://claw.163.com/skills-hub --skill email-diagnose -a openclaw -g -y
   ```

3. 使用 `/email-diagnose` 技能进行深度诊断（该技能会分析日志、匹配故障模式并给出修复建议）。

---

### 场景 7: 重启 Gateway

用户需要重启 Gateway，或修改配置后需要生效。

**步骤：**

1. 重启 Gateway：

   ```bash
   openclaw gateway restart
   ```

2. 等待 3-5 秒后，检查日志确认正常启动：

   ```bash
   openclaw logs --limit 20
   ```

> ⚠️ 重启会短暂中断所有频道监听（约 5-10 秒）。添加账号操作支持热加载，通常**不需要**重启。

---

## 错误处理策略

### npm 网络失败时切换镜像重试

当命令失败且错误信息含以下关键词时，视为网络问题：

- `ETIMEDOUT` / `ECONNREFUSED` / `ENOTFOUND`
- `fetch failed` / `408` / `timeout`
- `network` / `socket hang up`

**处理流程：**

```bash
# 使用国内镜像重试（仅影响当次命令，不修改全局配置）
npx --registry https://registry.npmmirror.com "@clawemail/claw-setup@latest" <原始参数（含 --skip-restart）>
```

### openclaw 命令失败时排查

当 `openclaw` 子命令（如 `plugins install`、`channels add`、`gateway restart`）执行失败时，可通过 `which openclaw` 定位命令源码路径，直接阅读源码分析失败原因并尝试修复。

```bash
# 定位 openclaw 命令位置
which openclaw
# 查看源码（通常是 JS/TS 脚本）
cat $(which openclaw)
```

### 步骤优先级策略

| 优先级 | 步骤 | 失败时行为 |
|--------|------|-----------|
| **必须成功** | 插件安装（`--install`）、频道添加（`channels add`） | **阻塞**：提示用户修复后再继续 |
| **按需执行** | Gateway 重启（插件或绑定有变更时） | 脚本输出提示后手动执行 |
| **尽力而为** | Agent 创建（`agents add`）、Agent 绑定（`agents bind`） | **警告**：记录失败，继续执行后续步骤 |
| **可选** | mail-cli 安装、mail-cli 认证 | **仅提示**：在最终摘要中汇报，不中断流程 |

> **注意**：安装脚本的核心步骤（插件安装、channels add）使用 `runStep()` 执行，失败时直接退出。mail-cli 相关步骤使用 `runOptionalStep()` 执行，失败仅输出警告并继续。因此 agent 看到脚本退出时，可以确定是核心步骤失败，需要提示用户修复。

---

## 安装后验证

安装或变更完成后，依次运行以下命令并汇总结果：

```bash
# 1. 检查插件已加载
openclaw plugins list

# 2. 检查频道状态（账号连接情况）
openclaw channels status --json

# 3. 查看最新日志（确认无报错）
openclaw logs --limit 20

# 4. 检查 Agent 绑定
openclaw agents list --bindings
```

**向用户展示汇总结果，格式如下：**

```
安装验证结果：

✅ 插件已加载：openclaw-email v0.x.x
✅ 账号 [default] 已连接：user@example.com
✅ 日志正常：无 ERROR
✅ Agent 绑定：default-agent → email/default

⚠️ 警告：[若有异常，在此说明]
```

- `✅` — 正常
- `⚠️` — 有警告或可选步骤失败（不影响核心功能）
- `❌` — 关键步骤失败（需要修复）

---

## Heartbeat（每日自检）

在 agent 启动时和每日定期执行以下维护检查：

### 1. 检查并更新插件

```bash
# 脚本内置版本比较，已是最新则自动跳过
npx "@clawemail/claw-setup@latest" --install --skip-restart
```

> 脚本执行完成后，先根据脚本输出向用户总结结果，然后检查是否需要重启：若输出包含 `"需要手动执行: openclaw gateway restart"`，告知用户后执行 `openclaw gateway restart`；否则无需重启，避免不必要的服务中断。

### 2. 更新 skill 到最新版本

先获取远程版本号，与本地对比，有新版本才更新：

```bash
# 获取远程版本号
curl -sL https://claw.163.com/skills-hub/skills/claw-email-setup | head -5
```

比较远程 frontmatter 中的 `version:` 与本地 `~/.openclaw/skills/claw-email-setup/SKILL.md` 的版本号。若远程版本更新，执行更新：

```bash
curl -sL https://claw.163.com/skills-hub/skills/claw-email-setup -o ~/.openclaw/skills/claw-email-setup/SKILL.md
```

### 3. 检查频道健康状态

```bash
# 查看所有账号连接状态
openclaw channels status --json

# 查看最近日志，确认无异常
openclaw logs --limit 20
```

**异常处理：**
- 账号连接失败 → 检查配置是否正确，必要时执行 `/email-diagnose`
- 日志中有 ERROR → 参考场景 6 排查
- 插件未加载 → 执行 `npx "@clawemail/claw-setup@latest" --install` 重新安装

---

## 基本使用

安装完成后，常用操作命令：

| 操作 | 命令 |
|------|------|
| 实时查看日志 | `openclaw logs --follow` |
| 检查频道状态 | `openclaw channels status` |
| 查看频道日志 | `openclaw channels logs --channel email` |
| 更新插件 | `openclaw plugins update @clawemail/email` |
| 更新 OpenClaw | `openclaw update` |
| 重启 Gateway | `openclaw gateway restart` |
| 查看 Agent 绑定 | `openclaw agents list --bindings` |

---

## 常见问题

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| `npx` 命令报 Node.js 版本错误 | Node.js 版本过低（需 ≥ 18） | 升级 Node.js：`nvm install 18 && nvm use 18`，或从 https://nodejs.org 下载安装 |
| npm 安装超时或网络失败 | 国内网络访问 npmjs.com 受限 | `npm config set registry https://registry.npmmirror.com` |
| auth-url 无效或过期 | auth-url 有效期 30 分钟，已过期 | 联系服务提供方重新获取 auth-url |
| `channels add` 报账号已存在 | 账号 ID 重复 | 执行 `openclaw channels remove --channel email --account <id>` 后重试，或使用不同的 `--account-id` |
| `gateway restart` 失败 | 系统服务权限或进程占用 | 检查 `openclaw logs --limit 20` 或使用 `/email-diagnose` |
| 邮件不收发、连接异常 | 多种原因（配置、网络、认证等） | 安装并运行 `/email-diagnose` 进行深度诊断 |

---

## Prompt Suggestions

以下是用户可以直接尝试的提示语示例：

1. 「我有一个 auth-url，帮我安装 OpenClaw 邮件插件」
2. 「帮我安装邮件频道插件，账号是 work@claw.163.com」
3. 「我想添加一个新的邮箱账号 support@claw.163.com」
4. 「检查一下邮件插件的状态，是否正常运行」
5. 「邮件插件出问题了，帮我排查一下」
6. 「重启一下 Gateway，让配置生效」
7. 「更新邮件插件到最新版本」
