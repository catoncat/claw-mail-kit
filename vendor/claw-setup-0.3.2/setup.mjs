#!/usr/bin/env node
// @clawemail/claw-setup — Cross-platform OpenClaw email channel setup
// Node.js >=18 required. Zero runtime dependencies.

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

// ── Color output ──────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const C = {
  green:  s => isTTY ? `\x1b[0;32m${s}\x1b[0m` : s,
  yellow: s => isTTY ? `\x1b[1;33m${s}\x1b[0m` : s,
  red:    s => isTTY ? `\x1b[0;31m${s}\x1b[0m` : s,
  cyan:   s => isTTY ? `\x1b[0;36m${s}\x1b[0m` : s,
};

function out(msg)  { process.stdout.write(msg + '\n'); }
function err(msg)  { process.stderr.write(msg + '\n'); }
function step(msg) { out(C.green('[Step] ' + msg)); }
function info(msg) { out('  ' + msg); }
function ok(msg)   { out('  ✅ ' + msg); }
function warn(msg) { out('  ' + C.yellow(msg)); }

// ── Command execution ─────────────────────────────────────────────────────────

/**
 * Run an external command. Streams all I/O to the terminal.
 * On failure: prints structured error to stderr then exits.
 *
 * ★ 使用 shell: true 解决 Windows 上 Node.js 安全补丁导致的
 *   spawnSync .cmd EINVAL 问题 (CVE-2024-27980)
 */
function runStep(name, hint, cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });
  const code = result.status ?? 1;
  if (code !== 0) {
    err(C.red(`❌ [${name}] 失败（退出码 ${code}）`));
    const cmdline = [cmd, ...args].join(' ');
    err(`   执行命令: ${cmdline}`);

    // ★ 输出 spawn 级别的错误
    if (result.error) {
      err(C.red(`   系统错误: ${result.error.message} (code: ${result.error.code})`));
      if (result.error.code === 'ENOENT') {
        err(C.red(`   找不到命令 "${cmd}"，请确认已安装并在 PATH 中`));
      }
    }

    const output = [result.stdout, result.stderr]
      .filter(b => b?.length)
      .map(b => b.toString().trimEnd())
      .join('\n');
    if (output) {
      err('   输出:');
      for (const line of output.split('\n')) {
        err(`     ${line}`);
      }
    }

    err(C.yellow('   可能原因及建议操作：'));
    for (const line of hint.split('\n')) {
      err(C.yellow('   ' + line));
    }
    err('');
    err(C.cyan('   💡 如果问题无法解决，请将异常信息反馈到: claw.feedback@claw.163.com'));
    process.exit(code);
  }
  return result;
}

/**
 * Run an external command that is allowed to fail.
 * On failure: prints warning to stderr and returns false (does NOT exit).
 * On success: returns true.
 */
function runOptionalStep(name, hint, cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });
  const code = result.status ?? 1;
  if (code !== 0) {
    warn(`⚠️  [${name}] 失败（不影响邮件功能，可稍后手动处理）`);
    if (result.error) {
      err(`   系统错误: ${result.error.message}`);
    }
    const output = [result.stdout, result.stderr]
      .filter(b => b?.length)
      .map(b => b.toString().trimEnd())
      .join('\n');
    if (output) {
      const lines = output.split('\n').slice(0, 5);
      for (const line of lines) {
        err(`     ${line}`);
      }
    }
    warn(hint);
    return false;
  }
  return true;
}

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    mode: 'all',       // 'all' | 'install' | 'account'
    authUrl: process.env.CLAW_AUTH_URL || '',
    name: '',
    accountId: '',
    pass: '',
    apikey: '',
    skipRestart: false,
  };

  let i = 0;
  while (i < argv.length) {
    switch (argv[i]) {
      case '--install':    args.mode = 'install'; i++; break;
      case '--account':    args.mode = 'account'; i++; break;
      case '--all':        args.mode = 'all';     i++; break;
      case '--skip-restart': args.skipRestart = true; i++; break;
      case '--auth-url':
      case '--name':
      case '--account-id':
      case '--pass':
      case '--apikey': {
        const flag = argv[i];
        const val = argv[i + 1];
        if (val === undefined || val.startsWith('--')) {
          err(C.red(`❌ ${flag} 需要一个值`));
          err('使用 --help 查看帮助');
          process.exit(1);
        }
        i++;
        if (flag === '--auth-url')        args.authUrl   = val;
        else if (flag === '--name')       args.name      = val;
        else if (flag === '--account-id') args.accountId = val;
        else if (flag === '--pass')       args.pass      = val;
        else if (flag === '--apikey')     args.apikey    = val;
        i++;
        break;
      }
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        err(C.red(`❌ 未知参数: ${argv[i]}`));
        err('使用 --help 查看帮助');
        process.exit(1);
    }
  }

  // --auth-url: auto-prefix short URL
  if (args.authUrl && !args.authUrl.startsWith('http://') && !args.authUrl.startsWith('https://')) {
    args.authUrl = 'https://u.163.com/' + args.authUrl;
  }

  return args;
}

function printHelp() {
  out('用法：');
  out('  npx "@clawemail/claw-setup" --auth-url <url>                                    # 一键安装（推荐）');
  out('  npx "@clawemail/claw-setup" --all --name xx --account-id yy --pass zz           # IMAP 账号安装');
  out('  npx "@clawemail/claw-setup" --all --name xx --account-id yy --apikey ck_live_xx # WS 账号安装');
  out('  npx "@clawemail/claw-setup" --account --name xx --account-id yy --apikey ck_xx  # 仅添加 WS 账号');
  out('  npx "@clawemail/claw-setup" --install                                           # 仅安装/更新插件');
  out('  npx "@clawemail/claw-setup"                                                     # 默认全部执行');
  out('');
  if (process.platform === 'win32') {
    out('  ⚠️  PowerShell 用户：@ 是 PowerShell 特殊字符，请用引号包裹包名：');
    out('      npx "@clawemail/claw-setup"');
    out('');
  }
  out('');
  out('参数：');
  out('  --auth-url <url>       从临时授权链接获取账号信息（支持多账号）');
  out('  --apikey <value>       API Key（WS 账号凭证，或 mail-cli API Key）');
  out('  --pass <value>         密码/授权码（IMAP 账号凭证）');
  out('  --install              仅安装/更新插件');
  out('  --account              仅添加账号');
  out('  --all                  全部执行（默认）');
  out('  --skip-restart         跳过 Gateway 重启（agent 模式使用）');
  out('  --name <value>         邮箱前缀名称');
  out('  --account-id <value>   账号标识（default 表示默认账号）');
  out('');
  out('传输协议：');
  out('  提供 --pass（无 --apikey）  → IMAP/SMTP');
  out('  提供 --apikey（无 --pass）  → WebSocket');
  out('  交互模式下会提示选择');
}

// ── Node version guard ────────────────────────────────────────────────────────

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    err(C.red(`❌ Node.js >= 18 required (current: ${process.versions.node})`));
    err(C.yellow('   请升级 Node.js：https://nodejs.org'));
    err('');
    err(C.cyan('   💡 如有疑问，请联系: claw.feedback@claw.163.com'));
    process.exit(1);
  }
}

// ── Install helpers ───────────────────────────────────────────────────────────

function installOrUpdatePlugin() {
  step('检查 Email 插件安装状态 ...');
  const emailExtDir = join(homedir(), '.openclaw', 'extensions', 'email');

  if (existsSync(emailExtDir)) {
    info(`📁 目录 ${emailExtDir} 已存在，检查版本 ...`);

    // ★ shell: true — 避免 Windows EINVAL
    // ★ stdio: 全 pipe 避免 npm 日志干扰（即使成功 npm 也会输出日志路径到 stderr）
    const remoteResult = spawnSync(
      'npm', ['show', '@clawemail/email', 'version'],
      { stdio: 'pipe', timeout: 10000, shell: true },
    );
    const remoteVer = (remoteResult.status === 0 && remoteResult.stdout)
      ? remoteResult.stdout.toString().trim()
      : '';

    // Debug: log error if version check fails
    if (remoteResult.status !== 0) {
      warn(`⚠️  远程版本检测失败（退出码 ${remoteResult.status}）`);
      if (remoteResult.stderr) {
        const errLines = remoteResult.stderr.toString().trim().split('\n');
        // 过滤掉 npm 内部日志，但保留所有错误信息
        const realErrors = errLines.filter(l => {
          const trimmed = l.trim();
          // 过滤：日志路径提示、verbose/silly 开头的日志行、空行
          return trimmed &&
                 !trimmed.includes('A complete log of this run can be found') &&
                 !trimmed.startsWith('verbose ') &&
                 !trimmed.startsWith('silly ');
        });
        if (realErrors.length > 0) {
          warn('   npm 错误输出:');
          // 显示所有有用的错误行，最多 10 行避免刷屏
          realErrors.slice(0, 10).forEach(line => {
            warn(`     ${line}`);
          });
          if (realErrors.length > 10) {
            warn(`     ... 还有 ${realErrors.length - 10} 行错误信息被省略`);
          }
        }
      }
    }

    // Get local version
    let localVer = '';
    try {
      const pkgJson = JSON.parse(readFileSync(join(emailExtDir, 'package.json'), 'utf8'));
      localVer = pkgJson.version || '';
    } catch { /* treat as unknown */ }

    if (remoteVer && localVer && remoteVer === localVer) {
      ok(`插件已是最新版本 ${localVer}，跳过更新`);
      ok('插件就绪');
      out('');
      return false;
    } else {
      if (remoteVer && localVer) {
        info(`📦 发现新版本 ${remoteVer}（当前 ${localVer}），执行${C.yellow('更新')}操作`);
      } else {
        info(`📦 版本检查跳过（无法获取版本信息），执行${C.yellow('更新')}操作`);
      }
      runStep(
        'openclaw plugins update',
        '• openclaw 版本过旧，不支持此插件版本\n• 网络代理拦截\n• 建议：检查 openclaw 版本：openclaw --version\n• 建议：尝试卸载后重新安装：openclaw plugins remove email',
        'openclaw', ['plugins', 'update', '@clawemail/email@latest'],
      );
    }
  } else {
    info(`📁 目录 ${emailExtDir} 不存在，执行${C.yellow('安装')}操作`);
    runStep(
      'openclaw plugins install',
      '• openclaw 命令不存在（未安装 OpenClaw）\n• 网络代理拦截\n• 建议：确认 openclaw 已安装：which openclaw\n• 建议：手动安装：npm install -g "@clawemail/email"',
      'openclaw', ['plugins', 'install', '@clawemail/email'],
    );
  }
  ok('插件就绪');
  out('');
  return true;
}

function restartGateway() {
  step('重启 OpenClaw Gateway ...');
  runStep(
    'openclaw gateway restart',
    '• openclaw 服务未运行或权限不足\n• 插件加载时出现错误（配置有误）\n• 建议：查看日志：journalctl --user -u openclaw-gateway -n 50\n• 建议：手动重启：openclaw gateway restart\n• 建议：检查配置文件：~/.openclaw/openclaw.json',
    'openclaw', ['gateway', 'restart'],
  );
  ok('Gateway 已重启');
  out('');
}

// ── Account setup ─────────────────────────────────────────────────────────────

function addSingleAccount(name, accountId, credential, transport) {
  if (!name || !accountId || !credential) {
    err(C.red('❌ name、account、credential 均不能为空，跳过此账号。'));
    return null;
  }

  const email = `${name}@claw.163.com`;

  step('添加 Email Channel 账号 ...');
  info(`📧 邮箱地址: ${C.yellow(email)}`);
  info(`🏷  账号标识: ${C.yellow(accountId)}`);
  info(`🚀 传输协议: ${C.yellow(transport === 'ws' ? 'WebSocket' : 'IMAP/SMTP')}`);
  out('');

  // 构造 token：IMAP 用 email:password，WS 用 ws:email:apiKey
  const token = transport === 'ws'
    ? `ws:${email}:${credential}`
    : `${email}:${credential}`;

  runStep(
    'openclaw channels add',
    `• token 格式错误（IMAP 应为 email:password，WS 应为 ws:email:apiKey）\n• 账号标识 '${accountId}' 已存在（重复添加）\n• OpenClaw Gateway 未运行\n• 建议：检查已有账号：openclaw channels list\n• 建议：若账号已存在，可先移除：openclaw channels remove --channel email --account ${accountId}\n• 建议：确认 Gateway 运行状态：openclaw gateway status`,
    'openclaw', ['channels', 'add', '--channel', 'email', '--account', accountId, '--token', token],
  );
  ok('账号已添加');
  out('');

  if (accountId === 'default') {
    info('ℹ️  account 为 default，跳过机器人生成和绑定');
    out('');
    return { email, accountId, bindingAdded: false };
  }

  // Create agent workspace if missing
  const workspaceDir = join(homedir(), '.openclaw', `workspace-${accountId}`);
  step('检查并生成机器人 ...');
  if (existsSync(workspaceDir)) {
    info(`📁 工作区 ${workspaceDir} 已存在，跳过生成`);
  } else {
    info(`📁 工作区 ${workspaceDir} 不存在，生成机器人 ...`);
    runStep(
      'openclaw agents add',
      `• 工作区路径状态异常（目录存在但不完整）\n• 当前用户对目标目录无写入权限\n• 建议：检查目录状态：ls -la ${workspaceDir}\n• 建议：删除不完整目录后重试：rm -rf ${workspaceDir}`,
      'openclaw', ['agents', 'add', accountId, '--workspace', workspaceDir, '--non-interactive'],
    );
    ok('机器人已生成');
  }
  out('');

  // Bind agent if not already bound
  const openclawJson = join(homedir(), '.openclaw', 'openclaw.json');
  step('检查并绑定机器人 ...');
  let needBind = true;
  if (existsSync(openclawJson)) {
    try {
      const content = readFileSync(openclawJson, 'utf8');
      const bindingRe = new RegExp('"agentId"\\s*:\\s*"' + accountId + '"');
      if (bindingRe.test(content)) {
        info(`📋 绑定记录已存在于 ${openclawJson}，跳过绑定`);
        needBind = false;
      }
    } catch { /* treat as needs bind */ }
  }
  if (needBind) {
    info('📋 执行绑定 ...');
    runStep(
      'openclaw agents bind',
      `• agent '${accountId}' 不存在（生成步骤未成功）\n• openclaw.json 文件格式损坏\n• 建议：确认 agent 存在：openclaw agents list\n• 建议：检查配置文件：cat ${openclawJson}`,
      'openclaw', ['agents', 'bind', '--agent', accountId, '--bind', `email:${accountId}`],
    );
    ok('机器人已绑定');
  }
  out('');

  return { email, accountId, bindingAdded: needBind };
}

// ── Auth URL fetch ────────────────────────────────────────────────────────────

async function fetchAuthUrl(url) {
  step('从临时授权链接获取账号信息 ...');
  out('');

  let response;
  try {
    response = await fetch(url);
  } catch (e) {
    err(C.red('❌ [获取授权链接] 失败'));
    err(C.yellow('   • 授权链接已过期（有效期 30 分钟）'));
    err(C.yellow('   • 网络不可达，无法连接到授权服务器'));
    err(C.yellow('   • 链接 URL 格式错误'));
    err(C.yellow(`   错误详情：${e.message}`));
    err('');
    err(C.cyan('   💡 如果问题无法解决，请将异常信息反馈到: claw.feedback@claw.163.com'));
    process.exit(1);
  }

  if (!response.ok) {
    err(C.red(`❌ [获取授权链接] 失败（HTTP ${response.status}）`));
    err(C.yellow('   • 授权链接已过期或无效（有效期 30 分钟）'));
    err(C.yellow('   • 服务器返回错误，可能是链接已被使用'));
    err(C.yellow('   建议：重新生成安装命令以获取新的授权链接'));
    err('');
    err(C.cyan('   💡 如果问题无法解决，请将异常信息反馈到: claw.feedback@claw.163.com'));
    process.exit(1);
  }

  const body = (await response.text()).trim();

  if (!body) {
    err(C.red('❌ 授权链接返回空内容'));
    err(C.yellow('   建议：重新生成安装命令'));
    err('');
    err(C.cyan('   💡 如果问题无法解决，请将异常信息反馈到: claw.feedback@claw.163.com'));
    process.exit(1);
  }

  if (/<html|<!doctype/i.test(body)) {
    err(C.red('❌ [获取授权链接] 失败（服务器返回了 HTML 错误页面）'));
    err(C.yellow('   • 授权链接已过期或无效（有效期 30 分钟）'));
    err(C.yellow('   • 该链接已被使用过，每个授权链接只能使用一次'));
    err(C.yellow('   建议：重新生成安装命令以获取新的授权链接'));
    err('');
    err(C.cyan('   💡 如果问题无法解决，请将异常信息反馈到: claw.feedback@claw.163.com'));
    process.exit(1);
  }

  ok('账号信息获取成功');
  out('');
  return body;
}

/**
 * Split "name:accountId:authCode" — authCode may contain colons.
 * Returns { name, accountId, authCode } or null if line is malformed.
 */
function parseLine(line) {
  const first = line.indexOf(':');
  if (first === -1) return null;
  const second = line.indexOf(':', first + 1);
  if (second === -1) return null;
  return {
    name:      line.slice(0, first),
    accountId: line.slice(first + 1, second),
    authCode:  line.slice(second + 1),
  };
}

async function addAccountsFromAuthUrl(url) {
  const body = await fetchAuthUrl(url);
  const lines = body.split(/\r?\n/).filter(l => l.trim());

  // Phase 1: 提取 apiKey（仅存储，不再调用 mail-cli）
  let apiKey = null;
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (parsed.name === '__apikey__') {
      apiKey = parsed.authCode; // 第三字段是 apiKey
      info(`🔑 已提取 API Key`);
      out('');
      break;
    }
  }

  // Phase 2: 处理账号（仅 channels add + agent，不调用 mail-cli）
  let lineCount = 0;
  let successCount = 0;
  const accounts = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) {
      warn(`⚠️  忽略格式错误的行: ${line.substring(0, 50)}...`);
      continue;
    }
    if (parsed.name === '__apikey__') continue;

    lineCount++;
    out(C.cyan(`── 账号 ${lineCount} ──`));

    // 判断协议类型：authCode 为空 → WS，否则 → IMAP
    const isWs = !parsed.authCode || parsed.authCode.trim() === '';

    let result = null;
    if (isWs) {
      // WS 账号：需要 apiKey
      if (!apiKey) {
        err(C.red(`❌ WS 账号 ${parsed.name} 需要 apiKey，但未找到 __apikey__ 行，跳过此账号`));
        err(C.yellow('   • 建议：确认授权链接包含 __apikey__ 行'));
        continue;
      }
      result = addSingleAccount(parsed.name, parsed.accountId, apiKey, 'ws');
    } else {
      // IMAP 账号：使用 authCode 作为 password
      result = addSingleAccount(parsed.name, parsed.accountId, parsed.authCode, 'imap');
    }

    if (result) {
      successCount++;
      accounts.push(result);
    }
  }

  out(C.green(`  📊 共处理 ${lineCount} 个账号，成功 ${successCount} 个`));
  out('');

  return { accounts, apiKey };
}

// ── Interactive account input ─────────────────────────────────────────────────

/**
 * Prompt the user for a value via readline.
 * If `secret` is true, attempt to suppress echo (password input).
 */
async function prompt(question, secret = false) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    if (secret) {
      // Linux/macOS: disable terminal echo via stty
      const sttyOff = spawnSync('stty', ['-echo'], { stdio: 'inherit' });
      const useStty = sttyOff.status === 0;

      // Restore echo on Ctrl+C so terminal is not left in broken state
      if (useStty) {
        process.once('SIGINT', () => {
          spawnSync('stty', ['echo'], { stdio: 'inherit' });
          process.exit(130);
        });
      }

      // Windows fallback: suppress _writeToOutput (private API, Node 18–22)
      if (!useStty && rl._writeToOutput) {
        const orig = rl._writeToOutput.bind(rl);
        rl._writeToOutput = s => { if (s === question) orig(s); };
      }

      rl.question(question, answer => {
        if (useStty) spawnSync('stty', ['echo'], { stdio: 'inherit' });
        process.stdout.write('\n');
        rl.close();
        resolve(answer);
      });
    } else {
      rl.question(question, answer => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function promptAccount(prefilledName, prefilledAccountId, prefilledPass, prefilledApikey) {
  out(C.cyan('----------------------------------------'));
  out(C.cyan('  账号绑定配置'));
  out(C.cyan('----------------------------------------'));
  out('');

  const name      = prefilledName      || await prompt('请输入 name（邮箱前缀名称）: ');
  const accountId = prefilledAccountId || await prompt('请输入 account（账号标识，输入 default 表示默认账号）: ');

  // Determine transport and credential
  let transport = 'imap';
  let credential = prefilledPass;

  if (prefilledApikey && !prefilledPass) {
    // --apikey provided without --pass → WS mode
    transport = 'ws';
    credential = prefilledApikey;
  } else if (!prefilledPass && !prefilledApikey) {
    // Interactive: ask which transport
    const choice = await prompt('请选择传输协议 (1=IMAP, 2=WebSocket) [1]: ');
    if (choice.trim() === '2') {
      transport = 'ws';
      credential = await prompt('请输入 API Key: ');
    } else {
      credential = await prompt('请输入 pass（密码/授权码）: ', true);
    }
  }
  // else: prefilledPass is set → IMAP (credential already = prefilledPass)

  return { name, accountId, credential, transport };
}

// ── Deferred mail-cli setup (optional) ───────────────────────────────────────

const mailCliStatus = {
  attempted: false,   // was deferredMailCliSetup() called?
  installed: false,
  apiKeySet: false,
  accounts: [],       // { email, accountId, registered: bool }
};

function deferredMailCliSetup(apikey, accounts) {
  mailCliStatus.attempted = true;
  out('');
  step('安装/配置 mail-cli 工具（可选）...');
  out('');

  // 1. Install mail-cli
  const listed = spawnSync('npm', ['list', '-g', '@clawemail/mail-cli'], {
    stdio: 'pipe',
    shell: true,
  });
  const alreadyInstalled = listed.status === 0;

  if (alreadyInstalled) {
    info(`📦 @clawemail/mail-cli 已安装，执行${C.yellow('更新')}操作`);
  } else {
    info(`📦 @clawemail/mail-cli 未安装，执行${C.yellow('安装')}操作`);
  }

  mailCliStatus.installed = runOptionalStep(
    'npm install @clawemail/mail-cli',
    '   💡 稍后手动安装: npm i -g @clawemail/mail-cli',
    'npm', ['i', '@clawemail/mail-cli', '-g', '--force'],
  );
  if (!mailCliStatus.installed) return;
  ok('mail-cli 就绪');
  out('');

  // 2. Set API key (if provided)
  if (apikey) {
    step('设置 mail-cli API Key ...');
    mailCliStatus.apiKeySet = runOptionalStep(
      'mail-cli auth apikey set',
      '   💡 稍后手动设置: mail-cli auth apikey set <apikey>',
      'mail-cli', ['auth', 'apikey', 'set', apikey],
    );
    if (mailCliStatus.apiKeySet) {
      ok('API Key 已设置');
    }
    out('');
  }

  // 3. Register each account
  for (const acc of accounts) {
    step(`注册 mail-cli 账号 (${acc.accountId}) ...`);
    const mailCliArgs = acc.accountId === 'default'
      ? ['auth', 'login', '--user', acc.email]
      : ['--profile', acc.accountId, 'auth', 'login', '--user', acc.email];

    const registered = runOptionalStep(
      `mail-cli auth login (${acc.accountId})`,
      `   💡 稍后手动注册: mail-cli ${acc.accountId === 'default' ? '' : `--profile ${acc.accountId} `}auth login --user ${acc.email}`,
      'mail-cli', mailCliArgs,
    );
    if (registered) {
      ok('mail-cli 账号已注册');
    }
    mailCliStatus.accounts.push({ ...acc, registered });
    out('');
  }
}

function printSummary(accountCount, mode, { pluginChanged, bindingAdded, skipRestart } = {}) {
  out(C.cyan('========================================'));
  out(C.cyan('  ✅ 安装完成！'));
  out(C.cyan('========================================'));

  if (mode === 'account') {
    // --account mode: only account was added, no plugin install
    if (accountCount > 0) {
      out(`  👤 账号:           ✅ ${accountCount} 个账号已添加`);
    }
  } else if (accountCount > 0) {
    out(`  📧 Email Channel:  ✅ 插件已安装/更新`);
    out(`  👤 账号:           ✅ ${accountCount} 个账号已添加`);
    out(`  🤖 机器人:         ✅ 已生成并绑定`);
  } else {
    out(`  📧 Email Channel:  ✅ 插件已安装/更新`);
  }

  // Gateway status
  const needRestart = pluginChanged || bindingAdded;
  if (needRestart && skipRestart) {
    out(`  🔄 Gateway:        ⏭️  需要手动重启`);
  } else if (needRestart) {
    out(`  🔄 Gateway:        ✅ 已重启`);
  } else if (mode !== 'account') {
    out(`  🔄 Gateway:        ✅ 无变更需要重启`);
  }

  // mail-cli status (only show if deferredMailCliSetup was actually called)
  if (mailCliStatus.attempted) {
    if (mailCliStatus.installed) {
      const regCount = mailCliStatus.accounts.filter(a => a.registered).length;
      const totalCount = mailCliStatus.accounts.length;
      if (totalCount > 0) {
        out(`  🔧 mail-cli:       ✅ 已安装，${regCount}/${totalCount} 个账号已注册`);
      } else {
        out(`  🔧 mail-cli:       ✅ 已安装`);
      }
    } else {
      out('');
      out(`  🔧 mail-cli:       ⚠️  安装失败（不影响邮件收发功能）`);
      out(`     手动安装: npm i -g @clawemail/mail-cli`);
    }
  }

  out(C.cyan('========================================'));
}

function handleRestart(pluginChanged, bindingAdded, skipRestart) {
  const needRestart = pluginChanged || bindingAdded;
  if (skipRestart) {
    if (needRestart) {
      out('');
      const reasons = [];
      if (pluginChanged) reasons.push('插件有变更');
      if (bindingAdded) reasons.push('绑定有变更');
      out(`⏭️  ${reasons.join('，')}，流程结束后需要手动执行: openclaw gateway restart`);
      out('');
    }
  } else {
    if (needRestart) {
      restartGateway();
    } else {
      step('跳过 Gateway 重启（无变更需要重启）');
      out('');
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  checkNodeVersion();

  const args = parseArgs(process.argv.slice(2));

  out(C.cyan('========================================'));
  out(C.cyan('  OpenClaw Email Channel 配置脚本'));
  out(C.cyan('========================================'));

  if (args.authUrl) {
    out(`  运行模式: ${C.yellow('一键安装（从临时链接获取账号）')}`);
    out('');

    // Phase 1: Core installation (critical)
    const pluginChanged = installOrUpdatePlugin();
    const { accounts, apiKey } = await addAccountsFromAuthUrl(args.authUrl);
    const bindingAdded = accounts.some(acc => acc.bindingAdded);
    handleRestart(pluginChanged, bindingAdded, args.skipRestart);

    // Phase 2: mail-cli (optional, non-blocking)
    deferredMailCliSetup(apiKey || args.apikey, accounts);

    // Phase 3: Summary
    printSummary(accounts.length, 'auth-url', { pluginChanged, bindingAdded, skipRestart: args.skipRestart });
  } else {
    out(`  运行模式: ${C.yellow(args.mode)}`);
    out('');

    switch (args.mode) {
      case 'install': {
        const pluginChanged = installOrUpdatePlugin();
        handleRestart(pluginChanged, false, args.skipRestart);
        if (args.apikey) deferredMailCliSetup(args.apikey, []);
        printSummary(0, 'install', { pluginChanged, bindingAdded: false, skipRestart: args.skipRestart });
        break;
      }

      case 'account': {
        const { name, accountId, credential, transport } = await promptAccount(
          args.name, args.accountId, args.pass, args.apikey
        );
        const result = addSingleAccount(name, accountId, credential, transport);
        const bindingAdded = result?.bindingAdded ?? false;
        handleRestart(false, bindingAdded, args.skipRestart);
        // No mail-cli setup in account-only mode
        printSummary(result ? 1 : 0, 'account', { bindingAdded, skipRestart: args.skipRestart });
        break;
      }

      case 'all':
      default: {
        const pluginChanged = installOrUpdatePlugin();
        const { name, accountId, credential, transport } = await promptAccount(
          args.name, args.accountId, args.pass, args.apikey
        );
        const result = addSingleAccount(name, accountId, credential, transport);
        const bindingAdded = result?.bindingAdded ?? false;
        handleRestart(pluginChanged, bindingAdded, args.skipRestart);
        // For WS mode, the credential (apikey) is used for mail-cli too
        const mailCliApikey = transport === 'ws' ? credential : args.apikey;
        const accounts = result ? [result] : [];
        deferredMailCliSetup(mailCliApikey, accounts);
        printSummary(result ? 1 : 0, 'all', { pluginChanged, bindingAdded, skipRestart: args.skipRestart });
        break;
      }
    }
  }
}

main().catch(e => {
  err(C.red('❌ 未预期的错误：' + e.message));
  if (e.stack) {
    err('');
    err('   Stack trace:');
    const stackLines = e.stack.split('\n').slice(1, 6);
    stackLines.forEach(line => err(`   ${line}`));
  }
  err('');
  err(C.cyan('   💡 请将上述异常信息反馈到: claw.feedback@claw.163.com'));
  process.exit(1);
});
