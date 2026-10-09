# Contributing

Meridian is a one-person project that runs in production every day. Fixes and ideas are welcome; this page says how the repository works so a change can land without surprises.

## Reporting a problem

Open an [issue](https://github.com/QuantaOverflow/meridian/issues/new/choose): there is a form for bugs and one for a self-hosting step that failed. Security problems go through [`SECURITY.md`](SECURITY.md) instead.

## Branches

- `meridian-dev` is where development happens. Open pull requests against it.
- `main` is what is running in production. It only receives merges from `meridian-dev`, after the change has been verified, and production is deployed only from `main`.

## Setting up

Local setup, the test commands and each service's HTTP surface are in [`docs/development.md`](docs/development.md).

`pnpm install` enables the git hooks in [`.githooks/`](.githooks): a fast check on commit, and on push the full set (typecheck, eslint, knip, route check, and the tests of the packages the push touches). CI runs the same checks. The backend tests need a local Postgres with pgvector; see [`apps/backend/test/README.md`](apps/backend/test/README.md).

## Making a change

- Keep a pull request to one thing. For a feature that needs several steps, stack small pull requests instead of sending one large one.
- Database changes: edit `packages/database/src/schema.ts`, run `pnpm -F @meridian/database generate`, review the SQL and commit both. Never edit an existing file under `packages/database/migrations/`.
- Tests are golden snapshots: they catch behaviour that changed by accident, not wrong answers. If you meant to change behaviour, update the snapshot and say so in the pull request.
- Changes to prompts or to the writing pipeline are judged by reading real output, so include a before and after.
- Never commit secrets. Workers read them from `.dev.vars` locally and from `wrangler secret` in production.

The pull request template asks for three things: a summary, the evidence that it works, and what could go wrong on merge.

## Language

Code, the README and the guides under `docs/` are in English. Decision records, the glossary, code comments and commit messages are in Chinese, the project's working language. Write a pull request in either.

## Working with coding agents

Most changes here are made by coding agents. The rules they follow are in [`CLAUDE.md`](CLAUDE.md), [`.claude/rules/`](.claude/rules) and [`docs/agents/`](docs/agents), and they apply to people as well.
