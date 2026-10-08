# Security

## Reporting a vulnerability

Please report it privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Do not open a public pull request or discussion for it.

Include what you found, how to reproduce it and what an attacker could do with it. You can expect a first reply within a week.

## Scope

- The code in this repository.
- The deployment it runs: the reader at `meridian-reader.pages.dev` and the backend API behind it.

Only the latest version on `main` is supported.

## Secrets

No credential belongs in this repository. Workers read secrets from `.dev.vars` locally (gitignored) and from `wrangler secret` or Cloudflare Secrets Store in production. If you find one committed, in the current tree or in history, report it the same way.
