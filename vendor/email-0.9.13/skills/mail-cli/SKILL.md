---
name: mail-cli
description: "CLI to read, send, search, and manage emails via mail-cli. Supports Coremail Ajax (claw.163.com accounts) and IMAP+SMTP (Gmail, etc.). Use when: (1) searching or reading emails, (2) moving/marking messages, (3) sending new email or composing with attachments, (4) managing Claw Agent sub-mailboxes (clawemail commands). NOT for: replying to a user's inbound message that needs In-Reply-To/References threading (use reply-user-message skill instead), or A2A email collaboration replies."
metadata: {"openclaw": {"emoji": "📬", "requires": {"bins": ["mail-cli"]}, "install": [{"id": "npm", "kind": "node", "package": "@clawemail/mail-cli", "bins": ["mail-cli"], "label": "Install mail-cli"}]}}
---

# mail-cli

## Installation

```bash
npm install -g @clawemail/mail-cli
```

## Transport

mail-cli automatically routes requests through two transport backends based on account address:

| Account pattern | Transport | Auth method |
|----------------|-----------|-------------|
| `*@claw.163.com` | Coremail Ajax (Claw API Gateway) | API Key (Bearer) |
| Everything else | IMAP + SMTP | OAuth2 / password |

## Critical Rules

**Rule 1: `--fid` is required for IMAP on `search`, `get`, `move`, `mark`, and all `read` sub-commands.**
Omitting `--fid` on IMAP accounts causes errors or wrong results.

```bash
# IMAP - always include --fid
mail-cli mail mark --ids "123" --fid INBOX --read
mail-cli mail search --fid INBOX --from boss@example.com --unread
```

**Rule 2: `clawemail list` lists Agent mailbox accounts (account-level); `folder list` lists mail folders within one account.**

**Rule 3: After `clawemail create`, save the auth code immediately.** It is shown only once.

**Rule 4: Use `--json` + `jq` for bulk operations.** Message IDs in table output may be truncated.

```bash
mail-cli mail search --fid INBOX --from boss@example.com --unread --json | \
  jq -r '[.[] | .id] | join(",")' | \
  xargs -I{} mail-cli mail mark --ids {} --fid INBOX --read
```

**Rule 5: `--profile` is a global option (before the command) to select the sending account.**

```bash
mail-cli --profile work compose send --to "a@b.com" --subject "Hi" --body "Hello"
```

## Global Options

```
--profile <name>    Use a named profile (default: config "default" value)
--json              Output results as JSON
--verbose           Show verbose protocol output
--config <path>     Use a custom config file path
```

## Auth & Config

Config file location: `~/.config/mail-cli/config.json` (macOS/Linux), `%APPDATA%\mail-cli\config.json` (Windows).
Override with `--config <path>` or set `XDG_CONFIG_HOME`.

```bash
# Store API Key for Claw Agent operations
mail-cli auth apikey set ck_live_xxxxxxxxxxxxxxxx

# Remove API Key
mail-cli auth apikey remove

# Login (Ajax/OAuth)
mail-cli auth login
mail-cli auth login --user someone@claw.163.com

# Logout
mail-cli auth logout

# Test authentication
mail-cli auth test

```

## Config File Structure

```json
{
  "default": "work",
  "apikeyRef": "mail-cli:apikey:work",
  "profiles": {
    "work": {
      "user": "myagent@claw.163.com"
    },
    "sub1": {
      "user": "myagent.bot1@claw.163.com",
      "displayName": "Bot One"
    },
    "gmail": {
      "host": "https://mail.google.com",
      "user": "user@gmail.com",
      "provider": "gmail",
      "imap": { "host": "imap.gmail.com", "port": 993 },
      "smtp": { "host": "smtp.gmail.com", "port": 465 },
      "tokenKey": "mail-cli:gmail:user@gmail.com"
    }
  }
}
```

Top-level fields: `default` (profile used when `--profile` is omitted), `apikeyRef` (keychain key for Claw Open API Key), `profiles` (named profile map).

Profile fields: `user` (required, email address), `host`, `displayName`, `provider` (`gmail`/`outlook`/`netease`/`custom`), `imap`/`smtp` (`{ host, port }`), `tokenKey`, `authMethod` (`oauth`/`password`).

## Claw Agent Mailboxes (clawemail)

All `clawemail` commands use the global API Key, not per-profile credentials.

```bash
# List all mailboxes in workspace
mail-cli clawemail list
mail-cli clawemail list --json

# Create a new sub mailbox (save the auth code shown - displayed only once)
mail-cli clawemail create --prefix bot1 --type sub --display-name "My Bot"

# View mailbox details (--uid defaults to current profile's user)
mail-cli clawemail info
mail-cli clawemail info --uid myagent.bot1@claw.163.com

# View or update Agent profile
mail-cli clawemail profile
mail-cli clawemail profile --uid myagent.bot1@claw.163.com
mail-cli clawemail profile --uid myagent.bot1@claw.163.com --display-name "New Name"

# Enable / disable a mailbox
mail-cli clawemail enable --uid myagent.bot1@claw.163.com
mail-cli clawemail disable --uid myagent.bot1@claw.163.com

# Show the master (primary) account email of the current workspace
mail-cli clawemail master-user
# → zhangsan@163.com

# JSON output (for scripting)
mail-cli clawemail master-user --json
# → { "success": true, "data": { "userEmail": "zhangsan@163.com" } }

# Delete a sub mailbox (primary cannot be deleted)
mail-cli clawemail delete --uid myagent.bot1@claw.163.com
```

`clawemail create` options:

| Option | Description |
|--------|-------------|
| `--prefix <prefix>` | Mailbox prefix, 1-64 characters |
| `--type <type>` | `primary` (one per workspace) or `sub` (multiple allowed) |
| `--display-name <name>` | Agent display name |

After `create`: resulting email is `<workspace-prefix>.<prefix>@claw.163.com`. A new profile named `<prefix>` is auto-added to `config.json`.

## Folder Operations

```bash
mail-cli folder list
mail-cli folder list --json
```

## Mail Operations

```bash
# List messages
mail-cli mail list --fid 1
mail-cli mail list --fid INBOX --limit 20 --desc
mail-cli mail list --fid 1 --unread --order date

# Get specific messages (--fid required for IMAP)
mail-cli mail get --ids "msg1,msg2"
mail-cli mail get --ids "msg1" --fid INBOX

# Search messages (--fid required for IMAP)
mail-cli mail search --fid INBOX --keyword "report" --limit 10
mail-cli mail search --fid INBOX --from "boss@example.com" --unread
mail-cli mail search --fid INBOX --keyword "invoice" --fts   # full-text search

# Move messages (--fid = source folder, required for IMAP)
mail-cli mail move --ids "msg1,msg2" --to-fid Trash --fid INBOX

# Mark messages (--read and --unread are mutually exclusive)
mail-cli mail mark --ids "msg1,msg2" --fid INBOX --read
mail-cli mail mark --ids "msg1" --fid INBOX --unread
```

`mail list` options: `--fid <id>` (required), `--order <field>`, `--desc`, `--limit <n>`, `--start <n>`, `--unread`.

`mail search` options: `--fid <folder>` (required), `--keyword <text>`, `--from <addr>`, `--to <addr>`, `--subject <text>`, `--since <date>`, `--before <date>`, `--unread`, `--fts` (full-text, requires `--keyword`), `--limit <n>` (default 50).

Note: `--fts` in Ajax mode ignores `--from`/`--to` filters and shows a warning.

## Read Message Content

```bash
# Body (default: HTML converted to plain text)
mail-cli read body --id <message-id>
mail-cli read body --id <message-id> --raw          # raw HTML
mail-cli read body --id <message-id> --out-file body.html
mail-cli read body --id <message-id> --json
mail-cli read body --id <message-id> --fid INBOX    # IMAP requires --fid

# Headers
mail-cli read header --id <message-id>
mail-cli read header --id <message-id> --fid INBOX
mail-cli read header --id <message-id> --json

# MIME structure (shows parts + part IDs for attachments)
mail-cli read structure --id <message-id>
mail-cli read structure --id <message-id> --fid INBOX

# Download attachment (use read structure first to find <part-id>)
mail-cli read attachment --id <message-id> --part <part-id>
mail-cli read attachment --id <message-id> --part <part-id> --out-file report.pdf
mail-cli read attachment --id <message-id> --part <part-id> --out-file ./downloads/
mail-cli read attachment --id <message-id> --part <part-id> --fid INBOX
```

## Compose & Send

```bash
# Basic send
mail-cli compose send --to "a@example.com" --subject "Hello" --body "World"

# Send from a specific profile (--profile is a global option, before the command)
mail-cli --profile work compose send --to "a@b.com" --subject "Hi" --body "Hello"

# With CC/BCC
mail-cli compose send --to "a@b.com" --cc "c@d.com" --bcc "e@f.com" --subject "Test" --body "Hi"

# HTML body
mail-cli compose send --to "a@b.com" --subject "HTML" --body "<h1>Hello</h1>" --html

# Read body from file
mail-cli compose send --to "a@b.com" --subject "Report" --body-file ./email.html --html

# Attachments (--attach is repeatable; use absolute paths)
mail-cli compose send --to "a@b.com" --subject "Files" --body "See attached" \
  --attach /absolute/path/report.pdf --attach /absolute/path/data.csv

# Priority (1=highest, 5=lowest, default=3)
mail-cli compose send --to "a@b.com" --subject "Urgent" --body "!" --priority 1
```

Use absolute paths for `--attach` to avoid working-directory ambiguity (do not use `~/...`).

## Quick Start: Claw Agent

```bash
# 1. Set API Key
mail-cli auth apikey set ck_live_xxxxxxxxxxxxxxxx

# 2. Create a profile for your main Claw account
mail-cli --profile work auth login --user myagent@claw.163.com

# 3. List existing mailboxes
mail-cli clawemail list

# 4. Create a sub mailbox (SAVE the auth code shown)
mail-cli clawemail create --prefix bot1 --type sub --display-name "My Bot"

# 5. Use the sub mailbox
mail-cli --profile bot1 mail list --fid 1
mail-cli --profile bot1 compose send --to user@example.com --subject "Hi" --body "Hello from bot"
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Missing `--fid` on IMAP `search`/`mark`/`move`/`get`/`read` | Always specify `--fid <folder>` for IMAP accounts |
| Running `folder list` expecting agent accounts | Use `clawemail list` for agent account listing |
| Losing auth code after `clawemail create` | Copy it immediately; no recovery path |
| Truncated IDs in table output | Use `--json` and parse with `jq` |
| Using `--from`/`--to` with `--fts` in Ajax mode | `--fts` ignores fine-grained filters; use `--keyword` only |
| Relative path in `--attach` (including `~`) | Use absolute paths: `/home/user/...` not `~/...` |
| Forgetting `--profile` position | `--profile` is global: `mail-cli --profile work compose send ...` |
| Wrong profile name after `clawemail create` | Profile name defaults to `--prefix` value; confirm in `config.json` |
