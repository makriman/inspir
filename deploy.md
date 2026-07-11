# Cloudflare Workers Free Deploy Runbook

Production is intentionally limited to the product that can run reliably on Cloudflare Workers Free:

- multilingual marketing, learning, SEO, topic-catalogue, and guest-chat documents are Workers Static Assets;
- `/api/health` and `/api/guest-chat` are the only routes that execute the main Worker;
- the guest tutor streams OpenAI's SSE response through a small native Worker and enforces D1-backed global and guest quotas;
- games, accounts, saved chats, profiles, memory, admin, quiz/flashcard generation, and other private or mutating APIs are not routable in production.

Next and OpenNext are build tools only. The deployed request handler must not import Next or the OpenNext server runtime. The old `DOQueueHandler` binding, migration tag, and self binding remain solely to keep the existing Durable Object migration rollback-safe; they are dormant in normal traffic.

## Release invariants

- `wrangler.jsonc` has no `limits.cpu_ms`. The Free plan's 10 ms CPU ceiling is a hard constraint.
- `assets.run_worker_first` is exactly `/api/health` and `/api/guest-chat`. Broad globs such as `/api/*`, `/chat/*`, or `/*` are forbidden.
- Every public document, `/api/topics`, known topic-chat URL, localized topic-chat URL, static redirect, and asset returns `X-Inspir-Delivery: static-assets` without invoking Worker code.
- The two native APIs return `X-Inspir-Delivery: lean-api-worker` and `private, no-store`.
- Unknown topic URLs, UUID chat URLs, auth/private/admin/reset-password/game routes resolve to the Static Asset 404; retired mutation methods receive the Static Asset router's fail-closed 405.
- Static chat pages are `noindex, follow`, contain no marketing JSON-LD, initialize from the requested topic path, and use the complete curated main-app bundle for their language.
- Localized documents are emitted only when their committed curated bundle matches the current source hash and is complete. Partial English fallback inside a localized document is not allowed.
- Static HTML contains no `/_next/image` optimizer URLs.
- Static pages may load the reviewed GA/Clarity scripts but must not call the retired D1 product-event API.
- The global LLM daily ceiling fails closed. Guest session, fingerprint, and IP quota-storage errors may fail open only with a structured warning.
- Request JSON, message history, prompt length, response headers, cookies, and provider errors stay bounded. Provider secrets are never returned or logged.
- `/tnc` is a Static Assets `308` to `/terms`.
- `inspirlearning-www-redirect` remains the canonical `www` route Worker and returns `X-Inspir-Delivery: www-redirect-worker`.
- The main Worker and redirect Worker each have one version at 100%; no split rollout is accepted.

## Translation gate

The repository owns the curated translation bundles used at build time. D1 mirrors every current source namespace and stores the audited payload repairs used by the former runtime. Run the read-only repair verifier and require complete bundles for every language on the surfaces this Free deployment publishes globally:

```bash
pnpm cf:d1:repair-seo-translations
pnpm translations:static-main-app:check
pnpm translations:status -- --all-languages \
  --namespace=main-app \
  --namespace=marketing-shell \
  --namespace=route:home
```

If the audited SEO source hashes changed, capture a D1 Time Travel bookmark and apply the explicit incremental repair:

```bash
pnpm exec wrangler d1 time-travel info inspirlearning-prod --json
pnpm cf:d1:repair-seo-translations -- --remote --confirm-production
```

The repair must fail closed unless source extraction, the 69-language seed, Unicode normalization, and field validation all pass. It exports the affected translation tables to a mode-`0600`, ignored backup, rejects a projected write count above the repository's Free-plan safety budget, applies one atomic SQL file, and verifies every resulting row against the current source hash. Never run it routinely when the same hashes already pass.

If source rows alone need reconciliation, use the same bookmark/backup discipline and run:

```bash
pnpm cf:sync:site-translation-sources -- --remote --confirm-production
```

Never commit the generated SQL, backups, or reports.

## Local gates

Run the repository gates before every deployable change:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm cf:build
pnpm cf:check:resource-budget
pnpm cf:scan:source-secrets
pnpm cf:scan:build-artifacts
pnpm cf:check:www-redirect
pnpm cf:verify:local
pnpm cf:preflight:deploy
```

`pnpm cf:build` performs a clean sanitized OpenNext build and then materializes the prerender cache into `.open-next/assets`. Inspect `.open-next/static-marketing-assets-report.json` and require:

- at least 100 public HTML documents and all 69 non-English localized home documents;
- one static chat shell for every supported language;
- exact English and localized known-topic `308` redirects into query-based static chat shells, with fewer than Cloudflare's 100 dynamic redirect-rule limit;
- `index.html`, `404.html`, `/api/topics`, `_redirects`, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, and `llms.txt`;
- no game output and no `/_next/image` reference;
- asset-count, individual-file-size, source-hash, and secret scans all passing.

`pnpm cf:preflight:deploy` rejects stale source-fingerprinted gate evidence, any retired Vectorize/R2/Queue/cron binding, extra Worker-first route, paid CPU configuration, missing Static Asset 404 boundary, missing translation/static-chat artifacts, missing rollback-safe Durable Object infrastructure, or a main Worker that imports OpenNext.

For local browser coverage:

```bash
pnpm cf:d1:local:setup
pnpm cf:preview
```

Then, in a second terminal:

```bash
pnpm cf:test:e2e:preview
```

## Canonical `www` Worker

Static Asset matches bypass Next middleware. `inspirlearning-www-redirect`, configured by `wrangler.www-redirect.jsonc`, owns `www.inspirlearning.com/*` and issues a `308` to the same path/query on `https://inspirlearning.com`.

Dry-run it on every release. Deploy it only when its source or config changed:

```bash
pnpm cf:check:www-redirect
pnpm cf:deploy:www-redirect
pnpm exec wrangler deployments status --name inspirlearning-www-redirect --json
```

Verify exact path and query preservation:

```bash
curl -sS -D - -o /dev/null 'https://www.inspirlearning.com/about?utm_source=canonical-test'
curl -sS -D - -o /dev/null 'https://www.inspirlearning.com/hi?probe=a%2Fb'
curl -sS -X POST -D - -o /dev/null 'https://www.inspirlearning.com/api/health?probe=method'
```

All three responses must be `308`, contain `X-Inspir-Delivery: www-redirect-worker`, preserve the complete query, and point at the apex host. Keep both Custom Domains in the main config for DNS and certificate coverage.

## Atomic main deploy

Record the active versions before changing production:

```bash
pnpm exec wrangler deployments status --name inspirlearning --json
pnpm exec wrangler deployments status --name inspirlearning-www-redirect --json
curl -fsS https://inspirlearning.com/api/health
```

The main rollback target must be at or after `opennext-cache-queue-v1`; Cloudflare cannot roll a migrated Worker back to a pre-migration version.

After every local and translation gate passes:

```bash
pnpm cf:deploy
pnpm exec wrangler deployments status --name inspirlearning --json
```

`pnpm cf:deploy` reruns preflight, rebuilds from clean source, rematerializes assets, repeats resource/secret scans, and runs `wrangler deploy`. Do not deploy a hand-edited `.open-next` directory or bypass the wrapper. The native Worker and Static Assets manifest are one versioned deployment.

## Production verification

Use the single version UUID reported at 100%:

```bash
REQUIRE_LIVE_AI=1 REQUIRE_RESOURCE_SOAK=1 pnpm cf:verify:production -- \
  --expected-version <current-worker-version-id>

REQUIRE_LIVE_AI=1 pnpm cf:verify:worker-outcomes -- \
  --expected-version <current-worker-version-id> \
  --confirm-production

PLAYWRIGHT_BASE_URL=https://inspirlearning.com \
REQUIRE_LIVE_AI=1 \
pnpm cf:test:e2e:production -- --expected-version <current-worker-version-id>
```

The production gates must prove:

- an unpinned health request reports the exact 100% version and `free-static-lean-guest` architecture;
- `/api/health` and `/api/guest-chat` identify `lean-api-worker`, are private/no-store, and every sampled execution uses less than 8 ms CPU;
- guest chat returns real `text/event-stream`, at least one valid OpenAI text delta, and sane server quota headers;
- multilingual pages, known topic routes, `/api/topics`, SEO documents, redirects, chunks, and images identify `static-assets`;
- Hindi renders `lang=hi`, Arabic renders `dir=rtl`, localized main-app strings are not English fallbacks, and chat has `noindex, follow` without marketing JSON-LD;
- unknown/deep/UUID topic routes and retired GET surfaces are direct Static Asset 404s, while retired mutation methods are direct Static Asset 405s;
- static requests produce no main Worker tail event, API/RSC bootstrap, Next cache header, or private cache policy;
- tail events have `ok` outcomes, no exceptions or resource-limit logs, complete CPU samples, and no unexpected invocation;
- `www` preserves path/query in one redirect hop.

Fast independent header probes:

```bash
curl -fsSI https://inspirlearning.com/
curl -fsSI https://inspirlearning.com/hi
curl -fsSI https://inspirlearning.com/chat/learn-anything
curl -fsSI https://inspirlearning.com/api/topics
curl -fsSI https://inspirlearning.com/api/health
```

The first four must say `static-assets`; health must say `lean-api-worker` and be private/no-store.

## Rollback

Roll back the native Worker and its matching Static Assets together:

```bash
pnpm exec wrangler rollback <previous-post-migration-version-id> \
  --name inspirlearning \
  --message "Rollback failed inspir release"
pnpm exec wrangler deployments status --name inspirlearning --json
```

Require one version at 100%, check that health reports the rollback UUID, and rerun all production gates. Leave the `www` route Worker and both Custom Domains in place during an application rollback.

If the redirect Worker itself needs rollback:

```bash
pnpm exec wrangler rollback <previous-www-redirect-version-id> \
  --name inspirlearning-www-redirect \
  --message "Rollback failed www canonical redirect"
```

A Worker rollback does not roll back D1 translations. Prefer a reviewed forward correction. A full D1 Time Travel restore can discard unrelated later writes; it requires a write freeze, a fresh backup, an explicit write-loss window, and separate approval.

## Evidence hygiene

Before destructive maintenance:

```bash
pnpm cf:backup:frozen-cloudflare
pnpm cf:harden:backup-permissions -- --backup <backup-dir>
```

Never commit local backups, generated Cloudflare reports, `.env*`, `.dev.vars`, `.next`, `.open-next`, or other build artifacts.
