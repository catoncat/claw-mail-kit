# Project layout

Claw Mail Kit intentionally ships three surfaces from one repository. They share the same Claw/Coremail protocol knowledge, but they have different runtimes and deployment targets.

## Surfaces

- `cli/` — terminal CLI for setup, mailbox checks, search, read, send, reply, realtime watch, and agent mailbox account operations.
- `local/` — local-only browser UI served from `127.0.0.1`; it reads `.env` and keeps sensitive helper state in `.secrets/`.
- `worker/` — Cloudflare Worker + Static Assets app for a hosted private mailbox UI behind Cloudflare Access; it stores indexed mail state in D1 and secrets in Worker secrets / encrypted D1 settings.
- `skills/` — installable agent skills for users who want Codex/Claude-style agents to operate this project.
- `docs/` — protocol notes, Cloudflare deployment notes, screenshots, and references.
- `vendor/` — inspected upstream package snapshots used as protocol/reference material, not runtime source of truth.

## Runtime truth

- Local CLI and local UI are for one developer machine and use `.env` directly.
- Worker UI is for hosted use and should be protected by Cloudflare Access.
- Do not copy local secrets into Worker config or tracked files.
- Use `npm run clawmail -- ...` for CLI commands so path changes do not leak into docs or skills.

## Installable skills

The only repository-owned installable skill is under `skills/claw-mail/`. Upstream OpenClaw skill text, when kept for reference, is stored as ordinary Markdown under `vendor/**/upstream-skills/` so `npx skills add . --full-depth --list` does not offer the wrong package.
