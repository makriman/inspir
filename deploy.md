# Deployment Guide

This project deploys to Cloudflare Workers with OpenNext. Production data lives in Cloudflare D1, memory vectors live in Cloudflare Vectorize, and the OpenNext incremental cache uses R2.

The project intentionally keeps `middleware.ts` for request localization/auth routing even though Next 16 warns about the `proxy.ts` rename. `proxy.ts` currently emits a Node.js proxy output that `@opennextjs/cloudflare` 1.19.11 cannot deploy, while Edge Middleware builds successfully for Cloudflare.

## Prerequisites

- You are on the branch you intend to deploy, usually `main`.
- Cloudflare resources exist: `inspirlearning-prod`, `inspirlearning-memory-prod`, and `inspirlearning-next-cache-prod`.
- Production secrets are configured with `wrangler secret put`.
- A fresh local backup exists before any production cutover.
- Live AI and the dedicated admin Google test account Playwright gates pass before DNS cutover.

## Verification

Run the local gates:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm cf:verify:local
pnpm cf:test:e2e:preview
```

`pnpm cf:verify:local` writes `cloudflare/local-gates-report.json` into the selected local backup directory. It records app typecheck, Cloudflare Worker typecheck, lint, unit tests, source secret scan, runtime provider dependency scan, Next build, OpenNext build, OpenNext artifact secret scan, Wrangler deploy dry-run, and Wrangler startup-profile evidence. The startup profile is stored as `cloudflare/worker-startup.cpuprofile`, and the report includes a repo source fingerprint so production preflight rejects local-gate evidence after source changes. The Next/OpenNext build steps temporarily mask local `.env*` and `.dev.vars*` files, then restore them, so backed-up Vercel/Supabase env files cannot be compiled into the Worker artifact. `pnpm cf:test:e2e:preview` starts OpenNext/Workers preview with local D1 state and writes `cloudflare/playwright-preview-report.json`; migration status requires this report to be fresh and generated from the current repo source fingerprint. Routine smoke tests do not mutate production D1 usage tables. For the final pre-cutover check only, run the remote preview explicitly:

`pnpm cf:verify:local` also runs `pnpm cf:scan:source-secrets`, which writes `cloudflare/source-secret-scan-report.json`. The scan covers the same tracked and untracked source file set used for the source fingerprint, stores only redacted snippets, and fails if provider/API tokens, private keys, credentialed Postgres URLs, or R2/S3 access keys appear in source.

`pnpm cf:verify:local` also runs `pnpm cf:scan:runtime-providers`, which writes `cloudflare/runtime-provider-scan-report.json`. The scan is intentionally narrower than the source secret scan: it checks runtime app/config files for retired Supabase, Vercel, Postgres, and pgvector dependencies while allowing migration tooling and docs to retain provider-specific backup/import references.

`pnpm cf:verify:local` also runs `pnpm cf:scan:build-artifacts`, which writes `cloudflare/build-artifact-scan-report.json`. The artifact scan checks `.open-next`, including `.open-next/cloudflare/next-env.mjs`, records the current repo source fingerprint, and fails if retired provider keys or runtime secrets were compiled as OpenNext env fallbacks. Use `pnpm cf:build`, `pnpm cf:deploy`, and `pnpm cf:upload`; do not call `opennextjs-cloudflare build/deploy/upload` directly for production work because the direct commands can read ignored local env files.

```bash
pnpm cf:preview:remote
PLAYWRIGHT_BASE_URL=http://localhost:8787 REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 pnpm test:e2e
```

Run D1 and Vectorize checks:

```bash
pnpm cf:migration:rehearse:d1:local
pnpm cf:migration:rehearse:vectorize:local
pnpm cf:harden:backup-permissions
pnpm exec wrangler d1 execute inspirlearning-prod --remote --command "PRAGMA quick_check;"
pnpm exec wrangler d1 execute inspirlearning-prod --remote --command "PRAGMA foreign_key_check;"
pnpm exec wrangler vectorize info inspirlearning-memory-prod
pnpm cf:preflight:production
pnpm cf:status:migration
pnpm cf:cutover:checklist
pnpm cf:evidence:verify
```

`pnpm cf:migration:prepare` writes `cloudflare/source-table-coverage-report.json` and `cloudflare/d1-size-safety-report.json` in addition to the D1 and Vectorize import artifacts. The coverage report fails if the Supabase public schema has a table outside the explicit migration list, and the size report checks transformed rows against D1 row/value, SQL statement, and bound-parameter limits.

`pnpm cf:migration:rehearse:d1:local` writes `cloudflare/d1-local-rehearsal-report.json` into the selected local backup directory. It creates a fresh local SQLite database from the D1 schema, imports every transformed backup row, runs integrity checks, and compares per-table row counts and checksums against `cloudflare/d1-import-manifest.json`.

`pnpm cf:migration:rehearse:vectorize:local` writes `cloudflare/vectorize-local-rehearsal-report.json` into the selected local backup directory. It verifies that the generated Vectorize NDJSON artifact matches the manifest hash, exactly matches the Supabase pgvector exports and transformed D1 source rows, preserves stable vector IDs/metadata, and contains only 512-dimensional finite vectors.

`pnpm cf:harden:backup-permissions` writes `cloudflare/backup-permissions-report.json` and restricts the selected local backup tree to owner-only access: files `0600`, directories `0700`, and no symlinks. Production preflight re-checks the current filesystem permissions, so rerun it after regenerating final backup artifacts.

`pnpm cf:preflight:production` writes `cloudflare/production-preflight-report.json` and `cloudflare/env-migration-inventory.json` into the selected local backup directory. It must pass before production deploy during migration and cutover. It verifies local Supabase/Vercel backups, checksum evidence, public-table coverage, D1 size safety, D1 count/checksum parity, translation checksum parity, Vectorize local rehearsal and import parity, sanitized OpenNext artifact evidence, Wrangler production bindings, Cloudflare Queue inventory, Cloudflare secret-key inventory, and Vercel-to-Cloudflare env key placement without printing secret values. The env inventory records key names only and fails if a live Cloudflare secret duplicates a wrangler var or preserves a retired Supabase/Postgres key, because either can shadow the intended production config.

`pnpm cf:preflight:deploy` writes `cloudflare/deploy-preflight-report.json`; `pnpm cf:deploy` / `pnpm cf:upload` enforce that same preflight inside the sanitized OpenNext wrapper before any production deploy or upload can run. Before provider retirement is proven, it delegates to `pnpm cf:preflight:production`, so migration deploys remain fully backup- and cutover-gated. After `pnpm cf:status:migration` proves `providersRetired=true`, it switches to a steady-state Cloudflare-only gate: local build/test evidence, source secret scan, runtime provider dependency scan, OpenNext artifact secret scan, Wrangler production config, and a Wrangler deploy dry run. This keeps future Cloudflare deploys from depending on retired Vercel/Supabase backup files. Successful `pnpm cf:deploy` also writes `cloudflare/worker-deploy-report.json` with the deployed source fingerprint and deploy-preflight proof; final provider-retirement gates require this report to be fresh, clean, and generated by `opennext-deploy`.

The Worker uses `inspirlearning-memory-post-turn-prod` plus `inspirlearning-memory-post-turn-dlq` for post-turn memory extraction and synthesis. These queues must exist before deploy; `wrangler.jsonc` binds the producer and Worker consumer, while `cloudflare/queues-list.txt` records the local backup snapshot.

If preflight reports duplicate Cloudflare secret/wrangler var keys or retired Supabase/Postgres secrets, first generate and inspect the cleanup plan:

```bash
pnpm cf:cleanup:duplicate-secrets
```

Then apply only with the exact confirmations printed by the dry run:

```bash
CONFIRM_ENV_SECRET_CLEANUP=1 \
CONFIRM_BACKUP_DIR="$(pwd)/../inspirlearning-local-backups/<cloudflare-migration-dir>" \
CONFIRM_DUPLICATE_SECRET_KEYS=<comma-separated-key-list-from-plan> \
CONFIRM_RETIRED_SUPABASE_SECRET_KEYS=<comma-separated-key-list-from-plan> \
CONFIRM_SECRET_CLEANUP_KEYS=<comma-separated-combined-key-list-from-plan> \
pnpm cf:cleanup:duplicate-secrets -- --apply
pnpm cf:preflight:production
```

This cleanup removes only live Cloudflare secrets whose names duplicate non-secret `wrangler.jsonc` vars or retired Supabase/Postgres keys, and refuses to delete required secrets such as `OPENAI_API_KEY`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, auth secrets, admin emails, or the cron secret.

If D1 exact validation fails only for `llm_usage_daily` or `rate_limit_windows`, production traffic or smoke tests have changed runtime quota tables after import. That is still a pre-deploy blocker: enter write-freeze, rerun the confirmed `pnpm cf:migration:import:d1`, then rerun `pnpm cf:migration:validate:d1` immediately before deploy. Durable tables must always remain exact.

Final D1 and Vectorize import/validation reports are intentionally freshness-gated. `pnpm cf:preflight:production` refuses stale data reports or reports generated for a different backup directory, and it also requires the local Vectorize rehearsal report to match the generated artifact manifest. Rerun D1 import, D1 validation, and Vectorize import during the final write-freeze instead of relying on earlier migration evidence.

Set `APP_WRITE_FREEZE=1` on the currently serving production app before the final backup/import window, and keep `CONFIRM_WRITE_FREEZE=1` in the operator shell for the mutation commands. Before the freeze window, run `MIGRATION_WRITE_FREEZE_STATUS_URL=https://inspirlearning.com/api/migration/write-freeze pnpm cf:check:write-freeze`; it writes `cloudflare/write-freeze-readiness-report.json` and proves whether the serving app exposes the expected freeze-status contract. If the serving app cannot expose that endpoint, the final backup waiver now requires `CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE=1`, `CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED=1`, and `WRITE_FREEZE_OPERATOR_EVIDENCE_FILE=<local-file>`; that evidence file is copied into the local backup and checksummed. The final backup command must be `pnpm cf:migration:backup -- --final` with `CONFIRM_FINAL_BACKUP=1`, `CONFIRM_BACKUP_SOURCE_WRITES_FROZEN=1`, and `MIGRATION_WRITE_FREEZE_STATUS_URL=https://inspirlearning.com/api/migration/write-freeze` when that status endpoint is available. It writes `cloudflare/write-freeze-report.json`; production preflight refuses backups that are not marked final/frozen. The app-level freeze makes durable write surfaces return HTTP 503 with `code=write_freeze_active`: chat sends, guest chat, activity starts/reviews, profile/photo edits, memory edits/feedback, admin topic creation, cron memory synthesis, and OAuth/auth adapter writes. Read-only pages, saved chat loads, translation reads, and existing JWT session reads continue to work.

## Deploy

Deploy only after the gates pass:

```bash
MIGRATION_WRITE_FREEZE_STATUS_URL=https://inspirlearning.com/api/migration/write-freeze pnpm cf:check:write-freeze
CONFIRM_WRITE_FREEZE=1 \
CONFIRM_FINAL_BACKUP=1 \
CONFIRM_BACKUP_SOURCE_WRITES_FROZEN=1 \
MIGRATION_WRITE_FREEZE_STATUS_URL=https://inspirlearning.com/api/migration/write-freeze \
pnpm cf:migration:backup -- --final
pnpm cf:migration:prepare
pnpm cf:migration:rehearse:d1:local
pnpm cf:migration:rehearse:vectorize:local
pnpm cf:harden:backup-permissions
pnpm cf:status:migration
pnpm cf:cutover:checklist
CONFIRM_WRITE_FREEZE=1 \
CONFIRM_D1_IMPORT=1 \
CONFIRM_D1_DATABASE_NAME=inspirlearning-prod \
CONFIRM_D1_DATABASE_ID=7cb2ddf7-ca3d-4f46-a022-cc8b3a25b7b9 \
CONFIRM_BACKUP_DIR="$(pwd)/../inspirlearning-local-backups/<cloudflare-migration-dir>" \
pnpm cf:migration:import:d1
CONFIRM_WRITE_FREEZE=1 \
CONFIRM_CLOUDFLARE_ACCOUNT_ID=a1e5e542dc1d5fe5a5c6b2a10d755a81 \
CONFIRM_VECTORIZE_IMPORT=1 \
CONFIRM_VECTORIZE_RESET=1 \
CONFIRM_VECTORIZE_INDEX=inspirlearning-memory-prod \
CONFIRM_BACKUP_DIR="$(pwd)/../inspirlearning-local-backups/<cloudflare-migration-dir>" \
pnpm cf:migration:import:vectorize -- --reset
pnpm cf:migration:validate:d1
CONFIRM_WRITE_FREEZE=1 REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 PLAYWRIGHT_BASE_URL=http://localhost:8787 pnpm test:e2e
CONFIRM_WRITE_FREEZE=1 REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 pnpm cf:preflight:production
CONFIRM_WRITE_FREEZE=1 REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 pnpm cf:deploy
```

`pnpm cf:migration:import:d1` and `pnpm cf:migration:import:vectorize` are production mutation commands. They refuse to run unless `CONFIRM_WRITE_FREEZE=1`, exact target confirmations, and the selected backup directory are supplied. The final D1 import must reset and replace the production tables; `--skip-reset` is not accepted by the generated final cutover runbook, requires its own `CONFIRM_D1_SKIP_RESET=1` if invoked manually, and cannot satisfy final production preflight evidence. `pnpm cf:deploy` and `pnpm cf:upload` are also production-guarded. Before provider retirement, they run the migration production preflight through `pnpm cf:preflight:deploy`, so they intentionally fail until the final write freeze is confirmed, live AI is required, admin Google e2e credentials are present, and the latest D1/Vectorize validation reports are clean.

Before changing DNS, generate the cutover plan:

```bash
CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1 CLOUDFLARE_API_TOKEN_FILE=/path/to/cloudflare-api-token.0600 pnpm cf:verify:cloudflare-token
CLOUDFLARE_API_TOKEN_FILE=/path/to/cloudflare-api-token.0600 pnpm cf:dns:prepare-cutover
```

Use `CLOUDFLARE_API_TOKEN_FILE` or `CF_API_TOKEN_FILE` for DNS steps when possible. The file must contain only the token and must be `0600` or stricter so the token does not land in shell history. Direct `CLOUDFLARE_API_TOKEN`/`CF_API_TOKEN` env values still work as a fallback.
`pnpm cf:verify:cloudflare-token` writes `cloudflare/cloudflare-api-token-capability-report.json` and checks whether the token can verify, read the `inspirlearning.com` zone, read DNS records, and create/delete one temporary TXT record named `_codex-migration-token-check.inspirlearning.com` before any DNS cutover command runs.

When the final write freeze is active and production preflight is clean, inspect `cloudflare/dns-cutover-dry-run-plan.json` and `cloudflare/dns-cutover-plan.json`, then apply the DNS blocker removal only if you are ready to immediately deploy the Worker custom domains:

```bash
CONFIRM_DNS_PLAN_FINGERPRINT=<planFingerprint-from-dry-run> \
CONFIRM_DNS_CUTOVER=1 \
CONFIRM_WRITE_FREEZE=1 \
CONFIRM_WORKER_CUSTOM_DOMAIN_DEPLOY=1 \
REQUIRE_LIVE_AI=1 \
E2E_GOOGLE_IS_ADMIN=1 \
CONFIRM_BACKUP_DIR="$(pwd)/../inspirlearning-local-backups/<cloudflare-migration-dir>" \
CLOUDFLARE_API_TOKEN_FILE=/path/to/cloudflare-api-token.0600 \
pnpm cf:dns:prepare-cutover -- --apply

CONFIRM_WRITE_FREEZE=1 REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 pnpm cf:deploy
```

`pnpm cf:dns:prepare-cutover` writes `cloudflare/dns-pre-cutover-inventory.json`, immutable dry-run evidence at `cloudflare/dns-cutover-dry-run-plan.json`, and a compatibility copy at `cloudflare/dns-cutover-plan.json`. Dry run does not mutate DNS and records a `planFingerprint`. Apply mode writes `cloudflare/dns-cutover-apply-report.json` without overwriting the reviewed dry-run plan. It deletes only DNS-only/Vercel host records that would bypass Cloudflare Workers or block Worker Custom Domain attachment, and it requires explicit confirmations, the exact `CONFIRM_BACKUP_DIR`, a clean production preflight report, a matching `CONFIRM_DNS_PLAN_FINGERPRINT`, no live DNS drift since the reviewed dry run, and an exact per-record fingerprint match immediately before every delete.
`CONFIRM_WORKER_CUSTOM_DOMAIN_DEPLOY=1` is intentionally separate because apply mode creates a short cutover window where the old Vercel records are removed and `pnpm cf:deploy` must run immediately afterward to attach the Worker custom domains from `wrangler.jsonc`.

Then smoke-check and record production evidence:

```bash
CLOUDFLARE_API_TOKEN_FILE=/path/to/cloudflare-api-token.0600 pnpm cf:verify:dns-cutover
REQUIRE_LIVE_AI=1 pnpm cf:verify:production
REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 PLAYWRIGHT_BASE_URL=https://inspirlearning.com pnpm cf:test:e2e:production
pnpm cf:migration:validate:d1:post-cutover
pnpm cf:migration:validate:vectorize:post-cutover
pnpm cf:status:migration
pnpm cf:cutover:checklist
pnpm cf:evidence:verify
```

`pnpm cf:verify:dns-cutover` writes `cloudflare/dns-cutover-report.json`. It verifies Cloudflare nameservers, public apex and `www` resolution, Cloudflare edge response headers, absence of Vercel response headers, the reviewed DNS dry-run/apply fingerprints, removal of the exact reviewed record IDs, and Cloudflare DNS inventory when `CLOUDFLARE_API_TOKEN_FILE`, `CF_API_TOKEN_FILE`, `CLOUDFLARE_API_TOKEN`, or `CF_API_TOKEN` is present.

`pnpm cf:migration:validate:vectorize:post-cutover` writes `cloudflare/vectorize-post-cutover-validation-report.json`. It is read-only and verifies every migrated Vectorize ID from the frozen backup is still present with matching embedding and metadata after Cloudflare cutover; extra runtime vectors are allowed so production smoke/Playwright-created memories do not invalidate the migration proof.

`pnpm cf:verify:production` writes `cloudflare/production-smoke-report.json` into the selected local backup directory. It verifies public pages, localized pages, SEO routes, OG image, topic API, live guest chat, Cloudflare edge headers, and absence of Vercel response headers.

`pnpm cf:test:e2e:production` writes `cloudflare/playwright-production-report.json` into the selected local backup directory. It refuses to run unless live AI and the dedicated Google test account env vars are present, and the account is explicitly confirmed as an admin with `E2E_GOOGLE_IS_ADMIN=1`.

`pnpm cf:migration:validate:d1:post-cutover` writes `cloudflare/d1-post-cutover-validation-report.json`. It keeps every durable data table on exact row-count/checksum parity and only permits the runtime quota tables `llm_usage_daily` and `rate_limit_windows` to change after production smoke traffic.

`pnpm cf:status:migration` writes `cloudflare/migration-status-report.json` and refreshes `cloudflare/evidence-manifest.json`. It is a non-mutating checkpoint that summarizes every backup, import, smoke, DNS, Playwright, and provider-retirement gate. Post-cutover D1 validation only counts after DNS cutover, production smoke, and production Playwright are clean. Add `-- --strict` when you want the command to exit non-zero until provider retirement is safe.

`pnpm cf:cutover:checklist` writes `cloudflare/final-cutover-checklist.json` and `cloudflare/final-cutover-checklist.md` into the selected local backup directory, then refreshes `cloudflare/evidence-manifest.json`. It is non-mutating and contains no secret values. Regenerate it after taking the final write-freeze backup; the generated commands intentionally include the exact frozen-backup confirmations, `CONFIRM_BACKUP_DIR`, D1 ID, Vectorize index, Vercel project identifiers, Supabase org/project ref, and DNS plan fingerprint placeholders needed for the destructive steps.

`pnpm cf:evidence:verify` verifies `cloudflare/evidence-manifest.json` and writes `cloudflare/evidence-manifest-verify-report.json`. Run it after `pnpm cf:status:migration` or `pnpm cf:cutover:checklist` and before destructive cutover/deletion work to prove the local backup and generated migration evidence still match their SHA-256 hashes. If either command runs again, rerun `pnpm cf:evidence:verify` before provider preflight or apply.

## Cutover And Deletion

Do not delete Vercel or Supabase until:

- Final Supabase backups and canonical exports are saved locally.
- Final D1 and Vectorize imports pass count/checksum validation.
- Cloudflare production smoke tests pass.
- Google sign-in, private chat, profile, memory, admin, quiz, flashcards, and guest chat pass Playwright.

Before deleting retired providers, run:

```bash
pnpm cf:evidence:verify

CONFIRM_PROVIDER_RETIREMENT=1 \
CONFIRM_BACKUP_DIR="$(pwd)/../inspirlearning-local-backups/<cloudflare-migration-dir>" \
CONFIRM_VERCEL_PROJECT=inspirlearning \
CONFIRM_VERCEL_PROJECT_ID=prj_7ksH63dGou99yBUh3oAohun7U3tD \
CONFIRM_VERCEL_ORG_ID=team_i2vqpXsvFILp19Mpj5UXuuXb \
CONFIRM_VERCEL_DELETE_TARGET=team_i2vqpXsvFILp19Mpj5UXuuXb/prj_7ksH63dGou99yBUh3oAohun7U3tD/inspirlearning \
CONFIRM_SUPABASE_ORG_ID=eovjqnvuqfmflaplfoue \
CONFIRM_SUPABASE_PROJECT_REF=<project-ref-from-dry-run> \
CONFIRM_SUPABASE_DELETE_TARGET=eovjqnvuqfmflaplfoue/<project-ref-from-dry-run>/<project-name-from-supabase-project-json> \
pnpm cf:preflight:retire-providers
```

Then inspect the deletion plan:

```bash
pnpm cf:retire-providers
```

Copy `planFingerprint` from `cloudflare/provider-retirement-dry-run-plan.json` after inspecting the dry-run targets and redacted commands. Apply mode requires that exact fingerprint so hard-delete cannot skip the reviewed deletion plan.

After that preflight passes, refresh status/checklist evidence so the provider-retirement preflight report is included in the manifest, then verify again:

```bash
pnpm cf:status:migration
pnpm cf:cutover:checklist
pnpm cf:evidence:verify
```

Then hard-delete Vercel and Supabase with explicit confirmations. Do not run `pnpm cf:status:migration` or `pnpm cf:cutover:checklist` between this evidence verification and apply unless you immediately rerun `pnpm cf:evidence:verify`.

```bash
pnpm cf:evidence:verify

CONFIRM_PROVIDER_RETIREMENT=1 \
CONFIRM_PROVIDER_HARD_DELETE=1 \
CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT=<planFingerprint-from-provider-retirement-dry-run> \
CONFIRM_BACKUP_DIR="$(pwd)/../inspirlearning-local-backups/<cloudflare-migration-dir>" \
CONFIRM_VERCEL_PROJECT=inspirlearning \
CONFIRM_VERCEL_PROJECT_ID=prj_7ksH63dGou99yBUh3oAohun7U3tD \
CONFIRM_VERCEL_ORG_ID=team_i2vqpXsvFILp19Mpj5UXuuXb \
CONFIRM_VERCEL_DELETE_TARGET=team_i2vqpXsvFILp19Mpj5UXuuXb/prj_7ksH63dGou99yBUh3oAohun7U3tD/inspirlearning \
CONFIRM_SUPABASE_ORG_ID=eovjqnvuqfmflaplfoue \
CONFIRM_SUPABASE_PROJECT_REF=<project-ref-from-dry-run> \
CONFIRM_SUPABASE_DELETE_TARGET=eovjqnvuqfmflaplfoue/<project-ref-from-dry-run>/<project-name-from-supabase-project-json> \
pnpm cf:retire-providers -- --apply
```

After hard deletion succeeds, revoke/rotate migration credentials and record the final completion evidence:

```bash
# Revoke/rotate the temporary Cloudflare API token used for DNS/migration work.
# Revoke/rotate the temporary R2 S3 access key and secret.
# Remove Vercel and Supabase CLI/API/database credentials from the operator shell.
# Write a local receipt/notes file that records those revocation actions.
unset CLOUDFLARE_API_TOKEN CF_API_TOKEN CLOUDFLARE_API_TOKEN_FILE CF_API_TOKEN_FILE R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY VERCEL_TOKEN SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_DB_URL SUPABASE_DATABASE_URL POSTGRES_URL POSTGRES_PRISMA_URL DATABASE_URL DATABASE_URL_UNPOOLED NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_JWT_SECRET SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL VERCEL VERCEL_ENV VERCEL_GIT_COMMIT_AUTHOR_LOGIN VERCEL_GIT_COMMIT_AUTHOR_NAME VERCEL_GIT_COMMIT_MESSAGE VERCEL_GIT_COMMIT_REF VERCEL_GIT_COMMIT_SHA VERCEL_GIT_PREVIOUS_SHA VERCEL_GIT_PROVIDER VERCEL_GIT_PULL_REQUEST_ID VERCEL_GIT_REPO_ID VERCEL_GIT_REPO_OWNER VERCEL_GIT_REPO_SLUG VERCEL_OIDC_TOKEN VERCEL_TARGET_ENV VERCEL_URL NX_DAEMON TURBO_CACHE TURBO_DOWNLOAD_LOCAL_ENABLED TURBO_REMOTE_ONLY TURBO_RUN_SUMMARY GEMINI_API_KEY GEMINI_TRANSLATION_MODEL OPENAI_TRANSLATION_CONCURRENCY OPENAI_TRANSLATION_FIELDS_PER_REQUEST OPENAI_TRANSLATION_MAX_RETRIES OPENAI_TRANSLATION_MODEL OPENAI_TRANSLATION_RETRY_DELAY_MS OPENAI_TRANSLATION_TIMEOUT_MS TRANSLATION_PROVIDER

CONFIRM_CLOUDFLARE_MIGRATION_API_TOKEN_REVOKED=1 \
CONFIRM_R2_MIGRATION_S3_KEY_REVOKED=1 \
CONFIRM_VERCEL_ACCESS_REVOKED=1 \
CONFIRM_SUPABASE_ACCESS_REVOKED=1 \
CONFIRM_RETIRED_PROVIDER_ENV_UNSET=1 \
CREDENTIAL_ROTATION_EVIDENCE_FILE=/path/to/local-rotation-receipt.txt \
pnpm cf:verify:credential-rotation

pnpm cf:status:migration
pnpm cf:cutover:checklist
pnpm cf:evidence:verify
```

`pnpm cf:retire-providers` writes dry-run evidence to `cloudflare/provider-retirement-dry-run-plan.json`; apply mode writes the destructive result to `cloudflare/provider-retirement-run.json`. Dry run records a `planFingerprint` over the active backup directory, backed-up Vercel/Supabase targets, and redacted deletion commands. Apply mode refuses to run unless `CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT` matches that reviewed dry-run plan, the dry-run plan is fresh and manifest-verified, the exact `CONFIRM_BACKUP_DIR` is supplied, the final write-freeze report is still fresh, the provider-retirement preflight, verified evidence manifest, and every production/DNS/Playwright/D1 report are clean and fresh, all reports point at the same backup directory, the manifest contains the critical local backup and final production evidence files, and the Vercel project name/project ID/org ID plus Supabase org/project ref confirmations match the backed-up targets exactly. The destructive run stores redacted command output only and reports `ok: true` after live post-delete lookups prove both retired provider projects are absent.

`pnpm cf:verify:credential-rotation` writes `cloudflare/credential-rotation-report.json` and copies `CREDENTIAL_ROTATION_EVIDENCE_FILE` to `cloudflare/credential-rotation-evidence.txt` with a SHA-256 hash. The migration is not complete until that report is clean, fresh, tied to the same backup directory, and the status report shows provider hard-delete plus credential rotation/revocation both passing.
