# Email Channel for OpenClaw

Email channel plugin for OpenClaw using IMAP IDLE for real-time receiving and SMTP for sending.

## Features

- **Real-time email receiving** via IMAP IDLE (push notifications)
- **SMTP sending** for agent replies
- **Thread tracking** using standard email headers (References, In-Reply-To)
- **Multi-account support** - one email per agent
- **Attachment handling** - downloads and passes to agent
- **HTML to Markdown** conversion for email content
- **Whitelist support** for controlling allowed senders
- **Automatic reconnection** with exponential backoff

## Configuration

### Single Account (Default)

```yaml
channels:
  email:
    enabled: true
    email: "agent@example.com"
    password: "${EMAIL_PASSWORD}"
    allowFrom:
      - "user@example.com"
      - "*.trusted-domain.com"
```

### Multi-Account

```yaml
channels:
  email:
    enabled: true
    defaultAccount: "agent-1"
    accounts:
      agent-1:
        email: "agent-1@example.com"
        password: "${AGENT1_PASSWORD}"
        allowFrom:
          - "*@example.com"
      agent-2:
        email: "agent-2@163.com"
        password: "${AGENT2_PASSWORD}"
        imapHost: "imap.163.com"
        smtpHost: "smtp.163.com"
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable email channel |
| `email` | string | - | Email address (default account) |
| `password` | string | - | Email password or app password |
| `imapHost` | string | `imap.{domain}` | IMAP server host |
| `imapPort` | number | `993` | IMAP port |
| `smtpHost` | string | `smtp.{domain}` | SMTP server host |
| `smtpPort` | number | `465` | SMTP port |
| `allowFrom` | string[] | - | Whitelist patterns |

## Whitelist Patterns

- Full email: `user@example.com`
- Domain wildcard: `*.example.com`
- User wildcard: `*@example.com`
- Domain only: `example.com`

## Supported Email Providers

The channel automatically derives IMAP/SMTP hosts for common providers:

- Gmail: `imap.gmail.com`, `smtp.gmail.com`
- Outlook/Hotmail: `outlook.office365.com`
- QQ Mail: `imap.qq.com`, `smtp.qq.com`
- 163/126 Mail: `imap.163.com`, `smtp.163.com`
- iCloud: `imap.mail.me`, `smtp.mail.me`

For custom hosts, specify `imapHost` and `smtpHost` explicitly.

## Security Notes

1. Use app-specific passwords when available (Gmail, Outlook, etc.)
2. Store passwords in environment variables, not in config files
3. Use whitelist patterns to restrict senders
4. Enable DM policies for spam control

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run type-check
```

## License

MIT
