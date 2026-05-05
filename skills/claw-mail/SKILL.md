---
name: claw-mail
description: "Use when a user wants an agent to operate a Claw Mail Kit checkout: configure Claw 163 agent mail, check/list/search/read mail, extract verification codes, send/reply to mail, run the Worker UI locally with Wrangler, or deploy the Cloudflare Worker version of this repository."
---

# Claw Mail Kit

Use this skill inside a cloned `claw-mail-kit` repository. Prefer repo scripts over hard-coded file paths.

## Boundaries

- Do not print `CLAW_API_KEY`, `.env`, `.dev.vars`, `.secrets/*`, auth-url responses, cookies, Access JWTs, or API tokens.
- Do not run OpenClaw setup commands unless the user explicitly asks to debug OpenClaw itself.
- For live mail content, return only what the user asked for: e.g. the code, subject, sender, or a short summary.
- Before saying mail was read, found, sent, or deployed, verify with the command/API result.

## Repo surfaces

- CLI: `npm run clawmail -- ...`
- Worker web UI: `worker/`, `wrangler.jsonc`, `npm run cf:dev`, `npm run cf:*`
- Detailed layout: `docs/project-layout.md`
- Protocol notes: `docs/claw-email-protocol.md`
- Worker deployment notes: `docs/cloudflare-architecture.md`

## Quick checks

```bash
npm run check
npm run clawmail -- list --limit 5 --json
```

## Common CLI operations

```bash
npm run clawmail -- list --limit 10 --json
npm run clawmail -- search --keyword "OpenAI" --limit 10 --json
npm run clawmail -- read --id '<message-id>' --json
npm run clawmail -- send --to person@example.com --subject 'Subject' --body 'Message body'
npm run clawmail -- reply --id '<message-id>' --body 'Reply body'
```

Use `--body-file` for long mail bodies to avoid shell quoting issues.

## Worker local dev

```bash
cp .dev.vars.example .dev.vars
npm run cf:migrate:local
npm run cf:dev
```

Open the local URL printed by Wrangler. Do not recreate or use a separate Node web server; the Worker path is the product web runtime.

## Cloudflare Worker work

Use Wrangler for Worker/D1/secrets/deploy operations. Keep secrets in Wrangler secrets, not tracked files.

```bash
npm run cf:typecheck
npm run cf:deploy:dry-run
```

For exact setup/deploy steps, read `docs/cloudflare-architecture.md` before changing `wrangler.jsonc`.
