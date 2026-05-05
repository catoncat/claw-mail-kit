# Project layout

Claw Mail Kit intentionally ships two product surfaces from one repository. The CLI and Worker UI share Claw/Coremail protocol knowledge, but have different runtimes and deployment targets.

## Surfaces

- `cli/` — terminal CLI for setup, mailbox checks, search, read, send, reply, realtime watch, and agent mailbox account operations.
- `worker/` — Cloudflare Worker + Static Assets app for the web UI. Run it locally with Wrangler during development, or deploy it behind Cloudflare Access for hosted use. It stores indexed mail state in D1 and secrets in Worker secrets / encrypted D1 settings.
- `skills/` — installable agent skills for users who want Codex/Claude-style agents to operate this project.
- `docs/` — protocol notes, Cloudflare deployment notes, screenshots, and references.
- `vendor/` — inspected upstream package snapshots used as protocol/reference material, not runtime source of truth.

## Runtime truth

- CLI is for terminal automation and uses `.env` directly.
- Worker UI is the only web runtime: use `npm run cf:dev` locally and protect hosted deployments with Cloudflare Access.
- Do not copy CLI `.env` secrets into Worker config or tracked files.
- Use `npm run clawmail -- ...` for CLI commands so path changes do not leak into docs or skills.

## Installable skills

The only repository-owned installable skill is under `skills/claw-mail/`. Upstream OpenClaw skill text, when kept for reference, is stored as ordinary Markdown under `vendor/**/upstream-skills/` so `npx skills add . --full-depth --list` does not offer the wrong package.
