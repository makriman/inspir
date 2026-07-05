# Cloudflare Deploy Runbook

Production runs on Cloudflare Workers with OpenNext. Use this runbook for steady-state changes after the app has already been moved fully onto Cloudflare.

## Local Gates

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm cf:build
pnpm cf:scan:source-secrets
pnpm cf:scan:build-artifacts
pnpm cf:verify:local
```

`pnpm cf:verify:local` writes its evidence to `tmp/cloudflare-reports/cloudflare/local-gates-report.json` and includes a source fingerprint so deploy preflight can prove the checked source matches the deployed source.

## Preview

```bash
pnpm cf:d1:local:setup
pnpm cf:preview
```

For browser regression coverage:

```bash
pnpm cf:test:e2e:preview
```

## Deploy

```bash
pnpm cf:preflight:deploy
pnpm cf:deploy
```

The deploy wrapper builds with sanitized environment files, scans OpenNext artifacts before upload, runs Wrangler through the checked Cloudflare config, and writes deploy evidence under `tmp/cloudflare-reports/cloudflare/`.

## Production Smoke

```bash
REQUIRE_LIVE_AI=1 pnpm cf:verify:production
PLAYWRIGHT_BASE_URL=https://inspirlearning.com \
REQUIRE_LIVE_AI=1 \
E2E_GOOGLE_EMAIL=<test-admin-email> \
E2E_GOOGLE_PASSWORD=<test-admin-password> \
E2E_GOOGLE_IS_ADMIN=1 \
pnpm cf:test:e2e:production
```

The smoke script checks the home page, localized route, SEO endpoints, topic API, and a live guest chat call.

Production Playwright can also use the hidden session-auth path instead of a browser Google password when `E2E_TEST_AUTH_SECRET` is configured for the Worker and present in the local shell.

## Data Backups

Before destructive maintenance, take a Cloudflare-native backup and lock down local permissions:

```bash
pnpm cf:backup:frozen-cloudflare
pnpm cf:harden:backup-permissions -- --backup <backup-dir>
```

Never commit local backups, generated Cloudflare reports, secrets, or build artifacts.
