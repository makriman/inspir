# Cloudflare Workers Free Deploy Runbook

Production is a static-first OpenNext deployment on Cloudflare Workers Free. The OpenNext build still supplies the dynamic application, but public marketing pages, supported localized pages, SEO documents, and immutable frontend assets are copied into `.open-next/assets` and served directly by Workers Static Assets. Those requests must not invoke the Worker.

Only explicitly listed dynamic surfaces enter the main OpenNext Worker: the deployed API endpoints, `/chat`, `/admin`, `/reset_pw`, and their supported localized workspace forms. `assets.not_found_handling` is `404-page`, so every other asset miss is a direct Static Asset `404` instead of an OpenNext invocation. The production `wrangler.jsonc` must not contain `limits.cpu_ms`; configurable CPU limits are not accepted on Workers Free. Treat the platform's 10 ms per-request CPU ceiling as a hard design constraint for every dynamic request.

## Release Invariants

- The game arena and game APIs are absent. `/games` must remain a `404`, and no game document may appear in the static asset report.
- Public HTML and SEO files are direct Static Assets, identified in production by `X-Inspir-Delivery: static-assets`.
- Static pages do not depend on OpenNext ISR, Worker execution, a managed HTML Cache Rule, or a post-deploy cache purge.
- Static HTML contains no `/_next/image` optimizer URLs; local and release-owned images are served directly as cached assets.
- Static layouts retain external GA/Clarity scripts but never beacon the D1-backed product-event API merely because a public page or `404` was viewed.
- `/tnc` is a native Static Assets `308` declared in `public/_redirects`; it must not invoke either Worker.
- The separate `inspirlearning-www-redirect` route Worker canonicalizes every `www.inspirlearning.com` request to the same path and query on `https://inspirlearning.com` and identifies itself with `X-Inspir-Delivery: www-redirect-worker`.
- `assets.run_worker_first` must equal the reviewed endpoint list in deploy preflight. Broad patterns such as `/api/*` or `/*` are forbidden; the list includes only real APIs plus unprefixed and localized chat/admin/reset paths, with the higher-precedence `!/_next/static/*` exclusion required so deep localized globs cannot capture Next client chunks.
- `assets.not_found_handling` remains `404-page`. Unknown public paths, unknown API paths, removed endpoints, and unsupported localized URLs must return the Static Asset `404` without invoking OpenNext.
- Localized documents are generated only for route/language pairs whose committed curated pack is complete and matches the current source hash. Generated links fall back to the canonical English URL when a localized document is unavailable; a direct unsupported locale URL returns the static `404` rather than rendering partial English copy.
- API routes enforce their own authorization and user scoping. Private, authenticated, mutating, and operational responses remain `private, no-store`.
- Worker-wide caching remains disabled.
- A release is atomic: the main application and redirect Worker must each have exactly one version at 100% of their traffic. Do not use a split main-Worker rollout while the OpenNext Durable Object revalidation self-call is not explicitly version-pinned.

## Local Gates

Start by validating the SEO translation repair contract. The verification form is read-only: it checks the exact source hashes and keys, the 69-language NFC seed, field validation, and the repair SQL without touching D1.

```bash
pnpm cf:d1:repair-seo-translations
```

Then run the application and Cloudflare gates:

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

`pnpm cf:build` runs the sanitized OpenNext build, materializes the prerendered public documents into `.open-next/assets`, enforces the Workers Static Assets file/count budgets, and scans the result. Inspect `.open-next/static-marketing-assets-report.json` and require all of the following before deployment:

- at least 100 public HTML documents and at least 50 localized home documents;
- `index.html`, `404.html`, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, and `llms.txt` are present;
- no materialized HTML contains `/_next/image`, and `/loading` is a real static document;
- no `games/` output exists;
- the asset-count and largest-file budgets pass;
- the report records the current OpenNext build ID and output SHA-256.

To rerun only the fail-closed materialization check against an existing OpenNext build while diagnosing an asset problem:

```bash
pnpm cf:materialize:static
```

This diagnostic command does not replace `pnpm cf:build`; the deploy wrapper always rebuilds and rematerializes from clean source.

`pnpm cf:check:www-redirect` performs a Wrangler dry run against `wrangler.www-redirect.jsonc`. The same `www-redirect-dry-run` check is part of `pnpm cf:verify:local`, which writes source-fingerprinted evidence to `tmp/cloudflare-reports/cloudflare/local-gates-report.json`. Deploy preflight rejects stale evidence, a paid-only CPU limit, a missing Static Asset 404 boundary, any broad/extra/missing Worker-first route, a failed main or redirect Worker dry run, or an incompatible production binding/schema state.

For local browser regression coverage:

```bash
pnpm cf:d1:local:setup
pnpm cf:preview
```

In a second terminal:

```bash
pnpm cf:test:e2e:preview
```

## Repair SEO Translations

Run the production repair only for a release that includes the audited SEO CTA source changes. First preserve the D1 Time Travel bookmark or timestamp in the release evidence:

```bash
pnpm exec wrangler d1 time-travel info inspirlearning-prod --json
```

Re-run the read-only verifier, then apply the explicitly confirmed repair:

```bash
pnpm cf:d1:repair-seo-translations
pnpm cf:d1:repair-seo-translations -- --remote --confirm-production
```

The remote command fails closed unless every generated namespace matches fresh source extraction and the 69-language seed matches the repair SQL exactly. Before writing it verifies D1 Time Travel and exports `app_translations`, `app_translation_sources`, and `app_translation_source_strings` to a mode-`0600`, ignored backup. It computes an incremental source diff, rejects a conservative projected write count above 50,000 billed D1 rows, and submits the source diff plus CTA payload repair as one atomic D1 SQL file. It never drops or rebuilds the source tables. Postchecks require every site row to be source-current and all 69 target languages to be complete for `route:about`, `route:media`, and `route:schools`.

Keep the command output, the pre-repair bookmark, the generated backup path, and `tmp/cloudflare-reports/cloudflare/seo-cta-translation-repair-remote.json` with the release evidence. The read-only run writes the adjacent `seo-cta-translation-repair-verify.json`. Never commit the SQL backup or generated reports.

If this repair has already passed against the same source hashes, do not turn it into a routine write on unrelated releases.

The standalone source synchronizer is also production-confirmed and incremental. If it is ever needed outside the repair, first capture Time Travel evidence and export the two source tables, then use the remote form:

```bash
pnpm cf:sync:site-translation-sources -- --remote --confirm-production
```

Inspect its reported logical and projected billed writes before proceeding. Workers Free allows 100,000 D1 rows written per UTC day across the account; the repository guard intentionally reserves at least half for normal application traffic and other release work.

## Canonical `www` Route Worker

Static Asset matches bypass Next middleware, so middleware cannot be the production canonical-host mechanism. The current deploy credential can write Worker routes but has only zone read access; it cannot create a zone-level Redirect Rule. The deployable production solution is therefore the separate `inspirlearning-www-redirect` Worker defined by `cloudflare-www-redirect.ts` and `wrangler.www-redirect.jsonc`.

Its route is `www.inspirlearning.com/*`. A Worker Route takes precedence over the main Worker's existing `www.inspirlearning.com` Custom Domain, so every `www` request reaches the tiny redirect Worker before the main application or its Static Assets. The redirect Worker:

- changes the scheme and host to `https://inspirlearning.com`;
- preserves the complete path and query string;
- returns `308` for every method;
- returns `X-Inspir-Delivery: www-redirect-worker` and bounded public caching;
- has no assets, storage bindings, application variables, secrets, or configurable CPU limit.

Keep both existing Custom Domains in the main `wrangler.jsonc`: `inspirlearning.com` and `www.inspirlearning.com`. The `www` Custom Domain continues to supply DNS and certificate coverage behind the higher-priority route. Do not combine this release with detaching that domain or changing its DNS.

Dry-run and deploy the redirect Worker before the main static-first Worker:

```bash
pnpm cf:check:www-redirect
pnpm cf:deploy:www-redirect
pnpm exec wrangler deployments status \
  --name inspirlearning-www-redirect \
  --json
```

Require one redirect Worker version at 100%, then validate it before continuing with the application cutover:

```bash
curl -sS -D - -o /dev/null \
  'https://www.inspirlearning.com/about?utm_source=canonical-test'

curl -sS -D - -o /dev/null \
  'https://www.inspirlearning.com/hi?probe=a%2Fb'

curl -sS -X POST -D - -o /dev/null \
  'https://www.inspirlearning.com/api/health?probe=method'
```

All three must return `308` and `X-Inspir-Delivery: www-redirect-worker`. Their `Location` values must respectively be:

```text
https://inspirlearning.com/about?utm_source=canonical-test
https://inspirlearning.com/hi?probe=a%2Fb
https://inspirlearning.com/api/health?probe=method
```

Confirm that the first probe is a single hop:

```bash
curl -sS -L --max-redirs 2 -o /dev/null \
  -w '%{url_effective} %{num_redirects} %{http_code}\n' \
  'https://www.inspirlearning.com/about?utm_source=canonical-test'
```

Expected output is `https://inspirlearning.com/about?utm_source=canonical-test 1 200`. A uniquely tagged `www` request must not appear in a tail of the main `inspirlearning` Worker; it intentionally creates one small invocation on `inspirlearning-www-redirect`.

### Optional later zero-invocation optimization

A zone-level Cloudflare Single Redirect can replace the route Worker later, eliminating even that small Free-plan invocation. It requires zone read plus Single Redirect edit permission, which the current deploy credential does not have and Wrangler does not manage. This is not part of the present cutover.

If the permission is added in a future release, create a `308` Single Redirect from `http*://www.inspirlearning.com/*` to `https://inspirlearning.com/${2}`, preserve the query string, and put it first. Prove exact path/query behavior and zero Worker invocation before removing the `www.inspirlearning.com/*` Worker Route. Update the production verifier and this runbook as part of that migration; until then, `X-Inspir-Delivery: www-redirect-worker` is the required production contract.

## Atomic Deploy

Before changing production, record the currently active Worker version and OpenNext build ID from `/api/health`:

```bash
pnpm exec wrangler deployments status --name inspirlearning --json
pnpm exec wrangler deployments status \
  --name inspirlearning-www-redirect \
  --json
curl -fsS https://inspirlearning.com/api/health
```

Keep the previous version UUID for each Worker as its independent rollback target. The main application target must be at or after the existing `opennext-cache-queue-v1` Durable Object migration; Cloudflare cannot roll a migrated Worker back to a pre-migration version.

After all local gates and any required D1 repair pass, use this order for the static-first cutover:

```bash
pnpm cf:check:www-redirect
pnpm cf:deploy:www-redirect
pnpm exec wrangler deployments status \
  --name inspirlearning-www-redirect \
  --json

# Run the three exact www header/location probes above before continuing.

pnpm cf:deploy
pnpm exec wrangler deployments status --name inspirlearning --json
pnpm cf:sync:topic-seeds -- --remote
```

Deploying and verifying the redirect route first closes the interval in which `www` could serve duplicate Static Asset content after the main cutover. On later releases, redeploy the redirect Worker only when its source or config changes, but always rerun its dry run and production probes before deploying the main Worker.

`pnpm cf:deploy` reruns deploy preflight, performs a clean sanitized OpenNext build, rematerializes the static documents, rechecks resource and secret budgets, and then calls `wrangler deploy`. Do not deploy a hand-edited `.open-next` directory and do not bypass the wrapper with an OpenNext skip-build flag.

The deployment is complete only when Wrangler reports one redirect version and one main application version, each at 100%. Topic synchronization is an explicit post-cutover reconciliation step; it must not run from public requests.

There is no HTML Cache Rule creation and no deploy-time HTML purge in this architecture. The Worker version and its Static Assets manifest are released together.

## Production Verification

Use the exact 100% Worker version UUID from Wrangler:

```bash
REQUIRE_LIVE_AI=1 REQUIRE_RESOURCE_SOAK=1 pnpm cf:verify:production -- \
  --expected-version <current-worker-version-id>

REQUIRE_LIVE_AI=1 pnpm cf:verify:worker-outcomes -- \
  --expected-version <current-worker-version-id> \
  --confirm-production
```

Production verification must prove all three delivery paths:

- `/`, a generated localized page such as `/hi`, `/robots.txt`, `/sitemap.xml`, locale sitemaps, RSS/LLM documents, and the static social preview return successfully with `X-Inspir-Delivery: static-assets`;
- `/manifest.webmanifest` and `/loading` are direct Static Assets, while `/tnc` returns a native Static Assets `308` to `/terms` without a Worker delivery marker;
- those public responses do not expose OpenNext render-cache headers, private/no-store policy, or a language-setting response cookie;
- `/api/health`, auth/session probes, topics, and guest chat execute the expected Worker version;
- every `www` probe returns `308`, the exact apex path/query, and `X-Inspir-Delivery: www-redirect-worker` from the separate redirect Worker;
- health and private/auth responses are `private, no-store` and never shared-cache hits;
- unknown paths, removed endpoints, and unavailable locale/route pairs return the direct Static Asset `404` and never enter OpenNext;
- idle public and static-404 documents create no same-origin API or RSC-prefetch request;
- stale translation APIs remain removed and the retired managed-topic catalog state is absent;
- the live guest tutor streams a non-empty bounded response.

Check the headers independently as a fast operational probe:

```bash
curl -fsSI https://inspirlearning.com/
curl -fsSI https://inspirlearning.com/hi
curl -fsSI https://inspirlearning.com/sitemap.xml
curl -fsSI https://inspirlearning.com/api/health
```

The first three responses must contain `X-Inspir-Delivery: static-assets`. `/api/health` must not contain that header and must contain a private/no-store cache policy.

Before either production gate accepts a release, Wrangler deployment status must show exactly the expected main Worker version at 100%, and an unpinned health request must report that same UUID. Version overrides are used only after this proof; they cannot substitute for proving what normal traffic receives.

The bounded Wrangler-tail gate generates multilingual Static Asset traffic, direct static 404 traffic, dynamic health/auth/topics/chat traffic, and one live streaming `POST /api/guest-chat`, all tagged by a unique query nonce. Every expected dynamic probe must have its own correlated tail event and CPU sample; unrelated production traffic cannot satisfy the count. Public assets and static 404 probes must create no main Worker invocation. The gate requires only `ok` outcomes, no exceptions/resource logs, and CPU below 8 ms for every sampled dynamic invocation. The 8 ms threshold reserves 2 ms (20%) beneath the Free-plan 10 ms termination ceiling for runtime and traffic variance.

Repeat the three canonical `www` probes after the release and require the exact `308` locations plus `X-Inspir-Delivery: www-redirect-worker`. A uniquely tagged `www` request must not appear in the main Worker tail.

Run the production browser suite when credentials for the authenticated flow are available:

```bash
PLAYWRIGHT_BASE_URL=https://inspirlearning.com \
REQUIRE_LIVE_AI=1 \
E2E_GOOGLE_EMAIL=<test-admin-email> \
E2E_GOOGLE_PASSWORD=<test-admin-password> \
E2E_GOOGLE_IS_ADMIN=1 \
pnpm cf:test:e2e:production -- --expected-version <current-worker-version-id>
```

The hidden session-auth path is an alternative only when `E2E_TEST_AUTH_SECRET` is temporarily configured in the Worker and local shell. Delete temporary test credentials immediately after the run and verify `/api/migration/e2e-auth` returns `404` again.

## Rollback

### Worker and Static Assets

Roll back the Worker and its associated Static Assets to the recorded, post-migration version:

```bash
pnpm exec wrangler rollback <previous-post-migration-version-id> \
  --name inspirlearning \
  --message "Rollback failed inspir release"
pnpm exec wrangler deployments status --name inspirlearning --json
```

Require one version at 100%, verify that `/api/health` reports the rollback UUID/build, and repeat the Static Asset header probes plus the Worker outcome gate. Do not restore or purge an incremental-cache R2 prefix as part of a normal rollback; public availability does not depend on that cache.

Leave the `inspirlearning-www-redirect` route Worker and both Custom Domains in place during an application rollback. Canonical-host routing is independent of the application version.

If the redirect Worker itself must be rolled back, use its separately recorded version:

```bash
pnpm exec wrangler rollback <previous-www-redirect-version-id> \
  --name inspirlearning-www-redirect \
  --message "Rollback failed www canonical redirect"
pnpm exec wrangler deployments status \
  --name inspirlearning-www-redirect \
  --json
```

Require one redirect version at 100% and rerun all three header/location probes. On the first redirect deployment, where no prior route-Worker version exists, redeploy the reviewed redirect source/config rather than removing the route and exposing duplicate `www` content.

### D1 Translation Repair

A Worker rollback does not roll back D1. Prefer a forward translation correction because D1 Time Travel restores the entire database and can discard unrelated writes made after the chosen point. Keep the site available while preparing a forward correction unless the data itself is unsafe.

If an emergency full D1 restore is genuinely required, first activate the documented write freeze, take a fresh full Cloudflare backup, and obtain explicit approval for the write-loss window. Then restore the recorded pre-repair bookmark:

```bash
pnpm exec wrangler d1 time-travel restore inspirlearning-prod \
  --bookmark <pre-repair-bookmark>
```

After any D1 restore, rerun the translation verifier, production smoke, authenticated data checks, and Worker outcome gate before lifting the write freeze. Do not import the runner's table backup wholesale over a live database; use it as audit evidence or as the source for a reviewed, targeted forward repair.

## Backups and Evidence

Before destructive maintenance, take and harden a Cloudflare-native backup:

```bash
pnpm cf:backup:frozen-cloudflare
pnpm cf:harden:backup-permissions -- --backup <backup-dir>
```

Never commit local backups, generated Cloudflare reports, `.env*`, `.dev.vars`, `.next`, `.open-next`, or other build artifacts.
