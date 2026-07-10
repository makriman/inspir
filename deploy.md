# Cloudflare Deploy Runbook

Production runs on Cloudflare Workers with OpenNext. Use this runbook for steady-state changes after the app has already been moved fully onto Cloudflare.

## Local Gates

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm cf:build
pnpm cf:check:resource-budget
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

Before changing production, record the current Worker version and OpenNext build ID from `/api/health` (for the one-time release that first adds this field, use the last verified production artifact's `.next/BUILD_ID`). Keep both values in the release evidence; the prior build ID is the only prefix eligible for later retirement.

### One-time Durable Object infrastructure release

Cloudflare applies a new Durable Object migration atomically and will not allow that version to be uploaded gradually. A migration also prevents rollback to versions from before the migration. Therefore, do **not** make the first `DOQueueHandler` migration from the application-relaunch checkout.

Create a dedicated release branch from the exact source revision serving production. Change only:

- `wrangler.jsonc`: add the `NEXT_CACHE_DO_QUEUE` binding and the `opennext-cache-queue-v1` `new_sqlite_classes` migration;
- `cloudflare-worker.ts`: export a rollback-compatible, unused `DOQueueHandler` class;
- generated Worker binding types required for that configuration.

Keep the existing dummy OpenNext queue in that infrastructure build so application behavior is unchanged. Run the full local gates, commit and push the infrastructure branch, then deploy it directly with `wrangler deploy`/the sanitized deploy wrapper. Confirm `wrangler deployments status --json` shows exactly one version at 100%, inspect that version with `wrangler versions view <version-id> --name inspirlearning --json` for the binding, and smoke the existing application. Record this version as the earliest post-migration rollback target. Only then proceed with the application release below.

### Atomic application release

```bash
pnpm cf:d1:apply-game-results -- --remote --confirm-production
pnpm cf:cache:upsert-marketing-html
pnpm cf:preflight:deploy
pnpm cf:deploy
pnpm exec wrangler deployments status --json
pnpm cf:cache:purge-deploy-html -- --confirm-production
pnpm cf:sync:topic-seeds -- --remote
```

The additive, idempotent game-results migration runs before the Worker cutover; deploy preflight verifies all 14 columns, bounded JSON payload storage, and the immutable-update trigger remotely. The managed Cache Rule bounds successful English marketing HTML to one hour and exact deploy-immutable localized pages to one year; it does not cache 3xx/4xx/5xx responses. Immediately after the first atomic cutover, the targeted purge removes prior-deploy marketing, localized, and accidentally cached API entries without flushing immutable assets; the release fails if this purge or the strict edge-cache verification fails. Topic seeds are synchronized explicitly after compatible code is live, so an older Worker never sees a new UI mode. The resumable, idempotent D1 batch sequence reconciles retired managed slugs and writes its completion hash only after all topic batches succeed, while public requests never perform seed writes or share initialization promises across requests. The deploy wrapper builds with sanitized environment files, enforces hard OpenNext/cache/locale artifact budgets, scans artifacts before upload, runs Wrangler through the checked Cloudflare config, and writes deploy evidence under `tmp/cloudflare-reports/cloudflare/`.

Localized pages are deploy-time immutable and are generated only where the committed curated packs prove full route coverage. Never deploy from a checkout missing the committed `translations/curated` route packs, and never restore hourly ISR on localized routes.

The Worker-wide `cache.enabled` switch must remain absent: it can cache private/auth responses regardless of cookies. Public HTML caching is limited to the managed marketing cache rule, whose cookie bypass and `/api` exclusion are independently verified. Localized cache rules must enumerate exact, source-hash-proven pages; never broaden them to `/{locale}/` prefixes, which can override private/no-store responses on localized workspace URLs.

OpenNext revalidation is deliberately serialized (`MAX_REVALIDATE_CONCURRENCY=1` and `NEXT_CACHE_DO_QUEUE_MAX_REVALIDATION=1`). Raise those values only with route-attributed CPU evidence from a production-like stale-cache soak.

The Worker CPU contract is explicit: `limits.cpu_ms` is 5,000. This is high enough for the bounded server replay and cold Next.js paths after the leak/stampede remediations, but well below Cloudflare's 30-second paid default. Do not remove it (which can restore an inherited legacy ceiling) or raise it without route-attributed tail evidence and a spend-risk review.

Production therefore requires the Workers Paid plan on the configured account. Cloudflare API error `100328` ("CPU limits are not supported for the Free plan") is a hard stop: upgrade the production account, then rerun the unchanged config. Never delete `limits.cpu_ms` merely to make a Free-plan upload succeed; that recreates 10 ms `exceededCpu` outages on localized rendering and game-result validation.

Never apply a bucket-wide expiry to the incremental-cache R2 bucket: a stable release could lose its active objects and stampede regeneration. After a new release has passed its production smoke, retire only the previous build prefix. The command requires the operator-confirmed active Worker version and build, independently verifies a single 100% deployment plus current no-store health, refuses to target the active build, and assigns the retired prefix an absolute expiration date 90 days after retirement.

### Rollout policy

This release remains atomic even after the infrastructure migration. Stock OpenNext’s Durable Object queue creates a new self-service-binding request without forwarding or setting a Worker version override. During a split deployment, a new queue object could therefore revalidate through old application code with a different build/prerender contract. Do not use `cf:upload` or a split rollout until that self-call is explicitly version-pinned and tested.

`pnpm cf:deploy` must produce one active application version at 100%. Capture its UUID from Wrangler, pass that exact UUID to every production verifier, and require `/api/health` to return it. Purge deploy HTML only after the single-version cutover; an older active version could otherwise refill shared edge cache.

## Production Smoke

```bash
REQUIRE_LIVE_AI=1 REQUIRE_RESOURCE_SOAK=1 pnpm cf:verify:production -- \
  --expected-version <current-worker-version-id>
pnpm cf:verify:worker-outcomes -- \
  --expected-version <current-worker-version-id> \
  --confirm-production
pnpm cf:verify:edge-cache -- --strict
PLAYWRIGHT_BASE_URL=https://inspirlearning.com \
REQUIRE_LIVE_AI=1 \
E2E_GOOGLE_EMAIL=<test-admin-email> \
E2E_GOOGLE_PASSWORD=<test-admin-password> \
E2E_GOOGLE_IS_ADMIN=1 \
pnpm cf:test:e2e:production -- --expected-version <current-worker-version-id>
```

The smoke script pins every request to and asserts the exact Worker version; checks Durable Object ISR revalidation, auth cache isolation across cookie variants, all three persisted game/result contracts, canonical locale fallbacks, removed translation APIs, SEO endpoints, topic reconciliation, a 69-locale resource soak, and a live guest chat call. The bounded Wrangler-tail gate filters the expected version, generates its own multilingual/game/auth/ISR soak, and fails on non-`ok` outcomes, exceptions, `exceededCpu`, `exceededMemory`, or dummy-queue logs. Production Playwright uses the same version override and asserts health before interactive game/result and authenticated checks.

Only after all smoke checks pass, apply the retired-prefix lifecycle rule:

```bash
pnpm cf:r2:retire-cache-build -- \
  --build-id <previous-open-next-build-id> \
  --expected-active-version <current-100-percent-worker-version-id> \
  --expected-active-build <current-open-next-build-id>
```

Production Playwright can also use the hidden session-auth path instead of a browser Google password when `E2E_TEST_AUTH_SECRET` is configured for the Worker and present in the local shell. Treat those E2E Worker secrets as temporary test-only credentials: create them for the focused production test, delete them immediately after the run, then verify `/api/migration/e2e-auth` returns `404` again.

## Data Backups

Before destructive maintenance, take a Cloudflare-native backup and lock down local permissions:

```bash
pnpm cf:backup:frozen-cloudflare
pnpm cf:harden:backup-permissions -- --backup <backup-dir>
```

Never commit local backups, generated Cloudflare reports, secrets, or build artifacts.
