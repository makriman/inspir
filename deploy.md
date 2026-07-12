# Cloudflare Workers Free Deploy Runbook

Production is intentionally limited to the product that can run reliably on Cloudflare Workers Free:

- multilingual marketing, learning, SEO, topic-catalogue, and guest-chat documents are Workers Static Assets;
- the Google-only account recovery document is a Worker-free Static Asset so old reset links still return users to their existing history;
- a narrow native Worker restores Google accounts, saved chats, profiles/photos, memory, admin, analytics, quiz/flashcard results, and authenticated chat without importing Next/OpenNext;
- guest and authenticated tutors stream through native handlers and enforce D1-backed per-learner quotas plus the fail-closed global budget; authenticated provider bytes pass through untouched and a small ownership-checked finalize request saves the completed answer;
- games remain completely removed.

Next and OpenNext are build tools only. The deployed request handler must not import Next or the OpenNext server runtime. The old `DOQueueHandler` binding, migration tag, and self binding remain solely to keep the existing Durable Object migration rollback-safe; they are dormant in normal traffic. Memory uses its existing D1, Vectorize, profile R2, Queue, DLQ, and daily cron bindings.

## Release invariants

- `wrangler.jsonc` has no `limits.cpu_ms`. The Free plan's 10 ms CPU ceiling is a hard constraint.
- `assets.run_worker_first` is the exact native API/chat-child allowlist in `scripts/cloudflare/deploy-preflight.ts`. Broad `/api/*` and `/*` globs are forbidden, and the higher-precedence `!/_next/static/*` rule keeps immutable Next chunks on Static Assets even though Cloudflare `*` patterns match deeply.
- Every public document, `/api/topics`, SEO document, static redirect, and asset returns `X-Inspir-Delivery: static-assets` without invoking Worker code.
- Native APIs return `X-Inspir-Delivery: lean-api-worker` and `private, no-store`.
- Known `/chat/:topic` paths receive a lean `308`; `/chat/:uuid` serves the static shell and loads messages only through an ownership-checked API. Unknown/deep paths remain `404`.
- Static chat pages are `noindex, follow`, contain no marketing JSON-LD, initialize from the requested topic or saved-chat path, and use the complete curated main-app bundle—including account/profile/memory copy—for their language.
- Localized documents are emitted only when their committed curated bundle matches the current source hash and is complete. Partial English fallback inside a localized document is not allowed.
- Static HTML contains no `/_next/image` optimizer URLs.
- Marketing pages load only reviewed GA/Clarity scripts. The workspace may additionally send bounded native product events.
- The global LLM daily ceiling fails closed. Guest session, fingerprint, and IP quota-storage errors may fail open only with a structured warning.
- Request JSON, message history, prompt length, response headers, cookies, and provider errors stay bounded. Provider secrets are never returned or logged.
- `/tnc` is a Static Assets `308` to `/terms`.
- `inspirlearning-www-redirect` remains the canonical `www` route Worker and returns `X-Inspir-Delivery: www-redirect-worker`.
- The main Worker and redirect Worker each have one version at 100%; no split rollout is accepted.
- The OpenNext build budget admits exactly the three complete localized static
  route families this release owns (home, chat shell, and mission). Its
  450-entry internal-cache guard leaves only deterministic headroom, while the
  exact 207-localized-entry cap and unchanged byte limits fail closed on a
  fourth route family or meaningful artifact growth. Static materialization
  separately enforces Workers Free's 20,000 final asset-file limit.

## Historical-data preservation gate

Capture a privacy-safe production baseline before the first release D1 mutation. Use one release-only HMAC secret in the same protected terminal for the final verification; never print, commit, or place it in a command argument:

```bash
export HISTORICAL_DATA_PRESERVATION_HMAC_SECRET="$(openssl rand -hex 32)"
pnpm cf:verify:historical-data-preservation -- \
  --capture-baseline \
  --confirm-production
```

The baseline fails on an empty/wrong database and covers users, OAuth accounts, sessions, chats, messages, admin grants, user memories, activity runs, product events, and profile-photo pointers. It stores only counts, schema identities, and at most 16 HMAC sentinels per dataset—never raw IDs, emails, session tokens, chat text, or memory text. Before its first D1 read it reserves the bounded maximum in the cumulative UTC-day ledger, then refines the exact billed reads. Evidence is source-bound, owner-only mode `0600`, nofollow-read, and fsynced. Deploy preflight requires it to be at most 30 minutes old. Final verification may reuse that exact baseline for at most 12 hours so the guarded deploy and live validation can finish, but the source-bound D1 ledger still forbids crossing the UTC billing-day boundary. Preflight rejects a missing, stale, wrong-source, wrong-ledger, malformed, symlinked, or broadly readable baseline.

After deployment, translation/topic reconciliation, authenticated mutation cleanup, and all other release writes, prove counts never decreased, every sampled historical identity remains, and baseline columns were not removed:

```bash
pnpm cf:verify:historical-data-preservation -- \
  --verify-preservation \
  --confirm-production
unset HISTORICAL_DATA_PRESERVATION_HMAC_SECRET
```

Do not unset or lose the HMAC secret before the final verification. A failed or indeterminate verification means the release is incomplete; do not replace its baseline or conceal the mismatch.

## Additive D1 runtime migrations 0013-0015

Before deploying this revision, apply all three tracked supplemental migrations in order. `0013` adds the bounded runtime indexes on `rate_limit_windows(reset_at)`, `ai_runs(created_at)`, and `ops_events(user_id)`; the last one keeps disposable validation cleanup from scanning the operations table. `0014` reads the durable all-time user, chat, message, and AI-run counts once and upserts the single `native-admin-totals-v1` `app_metadata` row. It excludes only the reserved `@inspirlearning.invalid` validation owner while retaining NULL/orphan historical chats and their child rows. `0015` adds nullable `completion_token` and `completion_message_id` columns to `activity_runs` plus one exact unique partial index for each non-NULL receipt. It does not replay or backfill historical completions. Local preview setup applies every unapplied supplemental migration automatically.

Use this exact production order: daily Free-plan budget reservation, guarded migration wrapper, read-only verification, then Worker preflight/deploy. The budget gate sums the current UTC day's D1 analytics across every database in the account, rejects truncated Query Insights, reserves one million reads and 20,000 writes for analytics lag and ordinary traffic, and bounds `activity_runs` while projecting all three `0013` indexes, both `0015` partial unique indexes, and three full `0014` snapshot-read passes for its ownership lookups. Its owner-only UTC-day ledger accounts cumulatively for release operations even while Cloudflare analytics lag, and rejects a stale day instead of rolling a reservation into the next day. It refuses before cardinality SQL when the daily allowance is exhausted and refuses any table that reaches its scan cap. Wait for the next `00:00 UTC` reset if it fails; do not bypass it or move this release to a paid plan.

```bash
# 1. Account-wide daily budget and bounded 0013-0015 cardinality projection.
pnpm cf:check:d1-migration-budget -- --confirm-production

# 2. Create durable diagnostic evidence, then apply the exact tracked files in order.
pnpm cf:apply:d1-runtime-migrations -- --confirm-production

# 3. Prove the complete 0013-0015 state before any Worker upload/deploy.
pnpm cf:verify:d1-runtime-migrations -- --confirm-production
```

Never run the three migration SQL files with ad-hoc Wrangler commands. The wrapper requires the fresh exact budget report and its live ledger reservation, records and fsyncs the Time Travel bookmark, database identity, source fingerprint, migration hashes, projection, and forward-correction-only policy before its first write, and verifies exact state after each migration. It serializes no destructive restore recipe. It refuses partial or stale state and never blindly retries an ambiguous `0015` response. The separate verifier is read-only and requires explicit production confirmation. It proves both `0015` columns, both exact unique partial index definitions, all three `0013` index definitions, and one valid `0014` snapshot whose four counts are non-negative integers. It atomically writes fresh, source-fingerprint-bound, mode-`0600` evidence under the active backup directory. `pnpm cf:preflight:deploy`, `pnpm cf:upload`, and `pnpm cf:deploy` reject missing, stale, non-regular, symlinked, wrong-mode, wrong-source, incomplete, or non-ok evidence, so the Worker cannot activate before `0015`. Finish, commit, and push the exact source before starting this sequence; any later tracked-source change invalidates the release evidence and must be resolved before deployment. None of these commands uses `d1 export`.

The production migration, standalone source sync, topic sync, Worker deploy, translation maintenance, authenticated validation, and main-Worker rollback all use the same D1-backed production exclusion. The three D1 child scripts refuse direct remote execution unless their parent wrapper proves the exact live owner. The parent revalidates the sole active Worker and repository fingerprint after acquisition, renews the lease while the child runs, holds it through the child report and authoritative readbacks, and releases only after final certification. A crashed non-validation operation leaves a bounded lease; after D1 declares it expired, the next guarded operation replaces it atomically. Do not invoke the underlying TypeScript files or raw Wrangler mutation commands directly.

All three migrations are additive. A Worker rollback leaves their columns, indexes, and snapshot in place; do not drop them during an application rollback.

## Translation gate

The repository owns the curated translation bundles used at build time. D1 mirrors every current source namespace and stores the audited payload repairs used by the former runtime. Run the read-only repair verifier and require complete bundles for every language on the surfaces this Free deployment publishes globally:

```bash
pnpm cf:d1:repair-seo-translations
pnpm translations:static-main-app:check
pnpm translations:status -- --all-languages \
  --namespace=main-app \
  --namespace=marketing-shell \
  --namespace=route:home \
  --namespace=route:mission
```

If the audited SEO source hashes changed, do not run the remote repair from an unvalidated working tree. Finish every local gate, commit and push the exact source, and deploy the candidate first; then use the post-deploy translation reconciliation section below. The repair binds itself to that candidate UUID, the pushed commit, fresh source-scoped gate reports, the native Worker hash, and a deterministic Static Assets manifest before it can upload maintenance code.

The repair must fail closed unless source extraction, all tracked curated packs, Unicode normalization, field validation, D1 statement/file limits, and the account-wide Free-plan budget all pass. Before its first target/snapshot D1 read it reserves the conservative maximum in the source-bound UTC-day release ledger; after the exact plan is known it refines that reservation and revalidates the candidate, source, immutable repair plan, ledger, and UTC day immediately before import. It never uses `d1 export`, because exports block database requests. Instead it validates a current Time Travel bookmark and writes a unique mode-`0600`, exclusively-created, fsynced diagnostic record plus an unresolved-operation marker before its first import. It applies one atomic SQL file and byte-verifies every resulting row. A definite mismatch or indeterminate outcome leaves maintenance active and requires a reviewed forward correction. Destructive whole-D1 Time Travel restore is unsupported on Free because the runtime cannot prove cross-store quiescence. A new repair refuses to start while an unresolved marker exists. Never run it routinely when the same hashes already pass.

The repair also persists an exact cross-workspace maintenance marker in production D1 while it still owns the global exclusion and before it activates the maintenance Worker. Ordinary deploy, validation, rollback, and release-maintenance wrappers refuse that marker even after the original lease expires. After a reviewed forward correction (or when evidence proves no D1 write occurred), resolve only the exact recorded run with:

```bash
pnpm cf:resolve:production-maintenance -- \
  --confirm-production \
  --repair-run-id <exact-repair-run-uuid>
```

The resolver is the sole marker bypass: it exact-reads the D1 state, acquires a recovery exclusion without stealing a live owner, accepts only the recorded candidate or maintenance version, restores the recorded candidate to 100%, proves that exact version healthy and unfrozen, durably writes fail-closed evidence, atomically clears the exact marker while still owning the lock, releases, and only then promotes the report to success. Never delete the D1 marker or deploy around it by hand.

If source rows alone need reconciliation, run the guarded standalone synchronizer:

```bash
pnpm cf:sync:site-translation-sources -- --remote --confirm-production
```

It performs a no-op without a bookmark or import when sources are already reconciled. A changed namespace whose payload hash would become stale is rejected and must go through the main atomic repair. For a safe source-only change it uses a source/plan-derived idempotent operation in the cumulative UTC-day ledger, reserving the maximum before its first snapshot and refining the exact cost before its write. It then records a Time Travel diagnostic bookmark, uses one D1 transaction, immediately revalidates source/plan/ledger/day identity, and exact-verifies the result. It never restores the live database after a mismatch; use a reviewed forward correction. A generated report is not successful evidence unless `timeTravelVerified`, `verifiedRows`, `verifiedSourceStringCount`, and its exact ledger binding all match the tracked manifest.

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
```

After those gates pass, commit and push the exact release source. Confirm the worktree is clean, the branch has an upstream, and local `HEAD` equals that upstream before any source-bound production evidence is collected. Run the production D1 preservation/migration gates in this runbook, then run `pnpm cf:preflight:deploy`. Preflight intentionally refuses a dirty, unpushed, or diverged tree; do not bypass it to obtain an early deploy report.

`pnpm cf:build` performs a clean sanitized OpenNext build and then materializes the prerender cache into `.open-next/assets`. Inspect `.open-next/static-marketing-assets-report.json` and require:

- at least 100 public HTML documents and all 69 non-English localized home documents;
- one static chat shell for every supported language;
- exact English and localized known-topic `308` redirects into query-based static chat shells, with fewer than Cloudflare's 100 dynamic redirect-rule limit;
- `index.html`, `404.html`, `/api/topics`, `_redirects`, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, and `llms.txt`;
- no game output and no `/_next/image` reference;
- asset-count, individual-file-size, source-hash, and secret scans all passing.

`pnpm cf:preflight:deploy` rejects dirty or unpushed Git state, stale source-fingerprinted gate evidence, missing or incorrect D1/Vectorize/profile-R2/Queue/cron bindings, any OpenNext incremental-cache R2 binding, an extra Worker-first route, paid CPU configuration, missing Static Asset 404 boundary, missing translation/chat/admin artifacts, missing rollback-safe Durable Object infrastructure, or a main Worker that imports OpenNext.

For local browser coverage:

```bash
pnpm cf:d1:local:setup
E2E_TEST_AUTH_SECRET="$(openssl rand -hex 32)" \
E2E_TEST_AUTH_EMAIL="codex-e2e@inspirlearning.invalid" \
pnpm cf:test:e2e:preview
```

The preview runner starts a sanitized Wrangler preview itself. When both E2E values are supplied, the local-only config treats that exact email as an admin so account, saved-chat, memory, admin, quiz, and flashcard coverage cannot silently skip. `E2E_TEST_AUTH_IS_ADMIN` is retired and has no effect.

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

`pnpm cf:deploy` reruns preflight, rebuilds from clean source, rematerializes assets, repeats resource/secret scans, and runs `wrangler deploy`. Do not deploy a hand-edited `.open-next` directory or bypass the wrapper. The native Worker and Static Assets manifest are one versioned deployment. A successful deploy atomically writes owner-only `cloudflare/worker-deploy-report.json` under the active backup directory, binding the sole 100%-active version UUID to the exact pushed source fingerprint, Worker/config hashes, and symlink-free Static Assets manifest.

## Post-deploy translation reconciliation

First run the guarded read-only production drift detector against the exact deployed source. It performs only bounded `SELECT`/`WITH` statements, writes no report or marker, and returns nonzero when a repair is required:

```bash
pnpm cf:d1:repair-seo-translations -- \
  --remote \
  --verify-only \
  --confirm-production
```

Only when that detector reports exact, determinate drift, run the guarded repair against the already deployed and committed candidate:

```bash
pnpm cf:d1:repair-seo-translations -- \
  --remote \
  --confirm-production \
  --confirm-native-write-freeze \
  --candidate-version <exact-100-percent-worker-version-uuid>
pnpm exec wrangler deployments status --name inspirlearning --json
```

The repair refuses a missing, stale-source, non-`0600`, symlinked, upload-only, unsuccessful, or version-mismatched Worker deploy report. It re-hashes the complete source/Worker/config/asset set before and after the maintenance upload and again immediately before activation, and also proves the captured candidate is still the sole version at 100%. The command then moves 100% traffic to the uniquely tagged, framework-free maintenance version: static pages remain available, while API, Queue, cron, and D1 mutation paths fail before touching D1. After exact verification it restores 100% traffic to the captured candidate UUID rather than compiling or deploying current local source. Lost Wrangler responses are resolved from repeated authoritative version/deployment readback. OpenNext and the retired cache R2 path cannot enter either transition. Continue using the original candidate UUID for every following production gate.

## Atomic managed-topic reconciliation

After the candidate Worker and Static Assets are the sole version at 100%, retire the removed arena and reconcile the tracked topic catalogue with one guarded transaction:

```bash
pnpm cf:sync:topic-seeds -- \
  --remote \
  --confirm-production \
  --candidate-version <exact-100-percent-worker-version-uuid>
```

The command requires `--candidate-version <exact-100-percent-worker-version-uuid>`. It validates the private, successful, source-bound deploy report before its first D1 query and repeats the exact Git/source/Worker/config/assets/version checks immediately before the import. It checks the cumulative UTC-day D1 release ledger before its first D1 SQL, records a diagnostic Time Travel bookmark and explicit forward-correction-only policy, executes one atomic SQL file, and exact-verifies every managed, retired, and untouched topic plus both seed metadata rows. It serializes no destructive restore recipe. A lost Wrangler response succeeds only after exact verification; a definite mismatch or indeterminate read requires a reviewed forward correction. It archives only `ai-game-arena` and stale slugs from the previous repository-owned `topic_seed_slugs` manifest; it never changes an existing topic ID or created timestamp and its SQL never reads or writes account, user, chat, message, session, or memory rows. If this command fails, the release is incomplete: roll back the candidate Worker before continuing and use a reviewed forward correction for D1.

## Production verification

Use the single candidate-version UUID reported at 100%. Authenticated production verification is mandatory and uses five temporary Worker secrets. The wrapper generates `E2E_TEST_MUTATION_RUN_ID` and a hard `E2E_TEST_AUTH_EXPIRES_AT`, manages `E2E_TEST_AUTH_REQUIRE_EXISTING=1`, and installs the operator-supplied `E2E_TEST_AUTH_EMAIL` and `E2E_TEST_AUTH_SECRET`. `E2E_TEST_AUTH_EMAIL` must be the exact lowercase email of an existing configured admin. The historical-account action fails with `409` if that user is absent, reuses the existing ID without updating any user/profile field, confirms `isAdmin` from server configuration, and never creates a user or admin grant. A separate candidate/run-bound action creates only a deterministic non-admin `@inspirlearning.invalid` disposable user for mutation validation. Keep `ADMIN_EMAILS` unchanged.

Run the guarded wrapper below instead of installing or deleting temporary secrets by hand. Before its first secret write, it proves all five temporary names are absent, validates the candidate's private deploy evidence and sole 100% deployment, and writes a private, fsynced recovery manifest under the active backup directory. The manifest binds the candidate, pushed source fingerprint, immutable Worker resources, baseline secret names, mutation run, 90-minute capability expiry, historical-session purposes, installed-secret progress, cleanup proofs, and the cumulative D1 lock budget. Each secret operation must produce only an exact secret-triggered version of the same immutable release. The wrapper installs the route capability last, samples the first real requests under tail, runs the outcome/smoke/private read-only Playwright and disposable mutation gates, then exact-cleans and independently verifies both historical validation sessions and the disposable graph before removing the route capability first and all remaining temporary secrets.

The private manifest is only the machine-local recovery record. Cross-workspace exclusion comes from one atomic compare-and-swap row at `app_metadata.native-production-validation-lock-v1`, acquired before any temporary secret mutation. Its exact non-secret owner contains only the candidate UUID, mutation-run UUID, source fingerprint, lease-generation UUID, and bounded lease expiry. D1's clock—not an operator workstation's clock—decides whether ownership is live or expired. A live foreign owner, noncanonical or malformed row, unexpected field, source mismatch, stale lease generation, or lost ownership fails closed. Renewal requires the exact prior canonical owner and a fresh lease generation. Recovery never steals a copied live generation; it waits for D1 expiry and then copied recovery processes race through one expired-owner compare-and-swap. The wrapper durably reserves each lock operation before invoking D1, enforces cumulative maxima of 128 operations, 1,024 rows read, and 64 rows written (including indexed primary-key writes), and records returned D1 billing metadata. It attests or renews ownership before and after every secret operation and authenticated child gate even when the operation itself fails, and holds the lock through the final secret-free outcome/production/hidden-route gates. Every ordinary production deploy, migration, sync, rollback, translation-repair, and authenticated-validation wrapper refuses a live owner or durable maintenance marker; only the exact confirmed recovery paths may reclaim expired ownership or resolve the recorded maintenance state. The lock is deleted with an owner-qualified statement and exact absent readback only after all validation residue is zero and all five temporary Worker secrets are authoritatively absent.

If validation or cleanup fails, the wrapper attempts to rotate the mint expiry to epoch `1` and retains the recovery manifest; do not delete that evidence. `SIGINT`, `SIGTERM`, `SIGKILL`, or machine loss cannot safely perform asynchronous network cleanup in a signal handler, so interruption deliberately leaves the capability bounded by its original expiry and requires the guarded `--recover` workflow below. After zero residue and authoritative absence of all five secrets, the wrapper discovers the final secret-free version, reruns the cold-first tail CPU/resource gate before the ordinary production verifier, proves the hidden route is `404`, and only then removes the manifest.

```bash
export E2E_TEST_AUTH_SECRET="$(openssl rand -hex 32)"
export E2E_TEST_AUTH_EMAIL="<exact-existing-configured-admin-email>"
REQUIRE_LIVE_AI=1 pnpm cf:verify:authenticated-production -- \
  --candidate-version <current-worker-version-id> \
  --confirm-production
unset E2E_TEST_AUTH_SECRET E2E_TEST_AUTH_EMAIL
```

If an interruption leaves the private recovery manifest, supply the same capability and exact email from the protected terminal and run cleanup before starting another validation:

```bash
export E2E_TEST_AUTH_SECRET="<same-32-to-512-byte-capability>"
export E2E_TEST_AUTH_EMAIL="<same-exact-existing-configured-admin-email>"
pnpm cf:verify:authenticated-production -- --recover --confirm-production
unset E2E_TEST_AUTH_SECRET E2E_TEST_AUTH_EMAIL
```

Recovery revalidates the current source fingerprint, deploy evidence, immutable active Worker resources, exact secret set, and stored D1 budget before changing remote state. It reacquires or renews only the manifest's same global lock identity, sweeps both deterministic historical-session purposes plus the complete disposable inventory, deletes secrets in the guarded order, proves the route is disabled, releases the lock with an absent readback, and retains the manifest on any indeterminate result. A recovered release must still rerun the full authenticated production validation before acceptance.

The outcome soak authenticates through the hidden migration route, verifies the exact admin identity without changing that user, and keeps its returned session cookie only in memory. Historical-account production probes are GET-only for profile, chat list/detail, account topics, memory, and admin state. The wrapper then authenticates the candidate/run-bound disposable user and production-proves profile mutation, current SSE chat plus explicit finalization, legacy text chat plus server-side persistence, memory create/update/list/delete, completed quiz and flashcard result experiences, and saved result readback. Its `finally` path transactionally deletes the disposable user's exact D1 graph, suppresses disposable queue/Vectorize work, and requires an authoritative all-zero inventory readback bound to the exact candidate/run/user/email identity and the actual invoked Worker version. An ignored version override, identity substitution, indeterminate readback, or nonzero cleanup fails the release. Every correlated invocation must have one exact `ok` tail event, no exception/resource-limit signal, a finite non-negative CPU sample, and less than 8 ms CPU. If the wrapper exits nonzero, treat the release as failed: use the private manifest and `--recover` when present, and independently inspect `wrangler secret list --name inspirlearning` for all five names: `E2E_TEST_AUTH_SECRET`, `E2E_TEST_AUTH_EMAIL`, `E2E_TEST_MUTATION_RUN_ID`, `E2E_TEST_AUTH_EXPIRES_AT`, and `E2E_TEST_AUTH_REQUIRE_EXISTING`.

Automated migration authentication does not validate Google's callback. Start `pnpm exec wrangler tail inspirlearning --format json`, then complete one real Google sign-in in a private browser window against the exact candidate version: start from the chat shell, select Google, finish consent, return to the expected chat URL, confirm `/api/me` shows the same historical user ID/email, and open an existing saved chat. Record the callback tail event and require an `ok` outcome, no exception or resource-limit event, and CPU below 8 ms. A functional callback without CPU evidence is not sufficient for this Free-plan release.

The production gates must prove:

- an unpinned health request reports the exact 100% version and `free-static-native-accounts` architecture;
- health, guest chat, signed-out account/state/admin probes, chat-child routing, and authenticated test-account flows identify `lean-api-worker`, are private/no-store where applicable, and every sampled execution uses less than 8 ms CPU;
- guest chat returns real `text/event-stream`, at least one valid OpenAI text delta, and sane server quota headers;
- multilingual pages, the account-recovery page, known topic routes, `/api/topics`, SEO documents, redirects, chunks, and images identify `static-assets`;
- Hindi renders `lang=hi`, Arabic renders `dir=rtl`, localized main-app strings are not English fallbacks, and chat has `noindex, follow` without marketing JSON-LD;
- unknown/deep topic routes and games are `404`; a UUID chat route returns only the shell, while unowned/private API access remains `401`/`404`;
- static requests produce no main Worker tail event, API/RSC bootstrap, Next cache header, or private cache policy;
- tail events have `ok` outcomes, no exceptions or resource-limit logs, complete CPU samples, and no unexpected invocation;
- `www` preserves path/query in one redirect hop.

The wrapper's reported secret-free version is the final release version. It must remain the only version at 100%, keep the real Google callback working, and have none of the five temporary names in `wrangler secret list --name inspirlearning`. Never leave any E2E validation secret configured after release. An interrupted operator must run `--recover`, perform an independent secret-list check, and rerun the complete validation before accepting the release.

Fast independent header probes:

```bash
curl -fsSI https://inspirlearning.com/
curl -fsSI https://inspirlearning.com/hi
curl -fsSI https://inspirlearning.com/chat/learn-anything
curl -fsSI https://inspirlearning.com/api/topics
curl -fsSI https://inspirlearning.com/api/health
```

Home, Hindi, and `/api/topics` must say `static-assets`. The topic-child redirect and health must say `lean-api-worker`; health is private/no-store.

## Rollback

Roll back the native Worker and its matching Static Assets together:

```bash
pnpm cf:rollback -- \
  --confirm-production \
  --target-version <previous-post-migration-version-id>
pnpm exec wrangler deployments status --name inspirlearning --json
```

The guarded rollback refuses a live validation or maintenance owner, rechecks the active baseline and source after acquiring the shared exclusion, heartbeats ownership while Wrangler runs, and requires the explicit rollback UUID to become the sole 100% version before it writes its private report and releases. Require one version at 100%, check that health reports the rollback UUID, and rerun all production gates. Leave the `www` route Worker and both Custom Domains in place during an application rollback.

If the redirect Worker itself needs rollback:

```bash
pnpm exec wrangler rollback <previous-www-redirect-version-id> \
  --name inspirlearning-www-redirect \
  --message "Rollback failed www canonical redirect"
```

A Worker rollback does not roll back D1 translations. Use a reviewed forward correction. Destructive whole-D1 Time Travel restore and cross-store restore are unsupported on Workers Free because the runtime cannot prove that every previously admitted HTTP, Queue, cron, R2, Vectorize, or `waitUntil` mutation has quiesced.

## Evidence hygiene

There is no supported frozen cross-store backup or destructive whole-D1 restore command on
Workers Free. A newly activated read-only Worker blocks new mutations, but cannot prove that old
connected HTTP invocations, 15-minute Queue/cron consumers, or previously admitted `waitUntil`,
R2, and Vectorize work has drained. Do not treat a sleep, a write-freeze status response, or a
Time Travel bookmark as quiescence evidence.

Production maintenance is limited to additive migrations and narrowly scoped atomic imports with
exact post-write verification. Time Travel bookmarks are diagnostic evidence only. If verification
is mismatched or indeterminate, keep the durable maintenance marker in place and prepare a reviewed
forward correction; do not run a whole-database restore. The runtime `APP_WRITE_FREEZE` guards and
status endpoint remain useful for the translation maintenance version, but they do not authorize a
cross-store backup or destructive restore.

Never commit local backups, generated Cloudflare reports, `.env*`, `.dev.vars`, `.next`, `.open-next`, or other build artifacts.
