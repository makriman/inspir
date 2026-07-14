# Cloudflare Workers Free Deploy Runbook

Production is intentionally limited to the product that can run reliably on Cloudflare Workers Free:

- multilingual marketing, learning, SEO, topic-catalogue, and guest-chat documents are Workers Static Assets;
- the Google-only account recovery document is a Worker-free Static Asset so old reset links still return users to their existing history;
- a narrow native Worker restores Google accounts, saved chats, profiles/photos, memory, admin, analytics, quiz/flashcard results, and authenticated chat without importing Next/OpenNext;
- guest and authenticated tutors stream through native handlers and enforce D1-backed per-learner quotas plus the fail-closed global budget; authenticated provider bytes pass through untouched and a small ownership-checked finalize request saves the completed answer;
- games remain completely removed.

Next and OpenNext are build tools only. The deployed request handler must not import Next or the OpenNext server runtime. The old `DOQueueHandler` binding, migration tag, and self binding remain solely to keep the existing Durable Object migration rollback-safe; they are dormant in normal traffic. Memory uses its existing D1, Vectorize, profile R2, Queue, DLQ, and daily cron bindings. The Queue consumer deliberately processes one message per invocation so a burst cannot multiply deterministic memory work past the Workers Free 10 ms CPU ceiling.

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
  enforces a 5,000-file internal release ceiling—well below Cloudflare's
  20,000-file Workers Free platform limit—and binds the complete asset-tree
  manifest into the materialization and deploy evidence.

## Historical-data preservation gate

In steady state, capture a privacy-safe production baseline before the first release data mutation. For this one-release rollover, the already archived V1 baseline is the pre-migration predecessor; capture the V2 successor only after the guarded `0016` migration and its read-only schema verification, but before the new Worker can activate or write an outbox job. The capture command generates one release-only 256-bit HMAC key, stores it as a non-overwriting macOS login-Keychain item whose account is the non-secret `hmacKeyId`, verifies the readback, and keeps the secret out of arguments, environment variables, reports, and command output. The login Keychain must be unlocked:

```bash
pnpm cf:verify:historical-data-preservation -- \
  --capture-baseline \
  --new-hmac-key \
  --confirm-production
```

The baseline fails on an empty/wrong database and covers users, OAuth accounts, sessions, chats, messages, admin grants, user memories, activity runs, product events, and profile-photo pointers. Every new V2 baseline also requires `ai_runs` plus the saved-memory storage and provenance graph: memory source edges, settings, chat summaries, indexed turns and their message/topic edges, profiles, user summaries, synthesis runs, source feedback, and memory events. It separately records `memory_vector_cleanup_outbox` as a bounded, mutable operational dataset. Outbox job rows are deliberately not historical learner records: successful cleanup must be allowed to delete them, so direct post-deploy preservation compares its schema but never requires its count or job identities to survive. Direct readers, deploy preflight, and post-deploy verification accept V2 only. The older ten-dataset V1 format is parsed solely for the byte- and SHA-pinned one-release rollover predecessor; it cannot be substituted for a current baseline. Evidence stores only counts, schema identities, and at most 16 HMAC sentinels per protected dataset—never raw IDs, emails, session tokens, chat text, memory text, vector IDs, or outbox ownership. Every count uses an inner `cap + 1` scan, both sparse profile-photo queries bound the underlying users scan before filtering, schemas are capped, and the operational outbox scan stops at 10,001 rows. One logical V2 snapshot has a proven 690,209-row bound and retains its 750,000-row logical cushion. Because Cloudflare may transparently execute each read-only statement up to three times, admission reserves the full 2,250,000-row worst-case billable ceiling before D1. Every returned result set must contain an exact integer `meta.total_attempts` of `1`; missing, invalid, or retried-attempt metadata fails closed, retains the maximum reservation, and cannot produce or refine a report. Only a single-attempt response whose summed `rows_read` remains within the logical bound refines that reservation to exact metadata. V2 evidence and the operation's snapshot-plan hash bind all four values: logical snapshot bound, logical cushion, maximum automatic attempts, and worst-case billable reservation. Evidence is source-bound, owner-only mode `0600`, nofollow-read, and fsynced. Deploy preflight requires it to be at most 30 minutes old. Final verification may reuse that exact baseline for at most 12 hours so the guarded deploy and live validation can finish, but its reservation remains bound to the exact source inside the one cumulative D1 ledger, which still forbids crossing the UTC billing-day boundary. Preflight rejects a missing, stale, wrong-source, wrong-ledger, malformed, symlinked, or broadly readable baseline.

An ordinary steady-state capture or verification reservation is single-use. If its source-bound operation already has either a maximum or exact reservation, repeating the command fails before `wrangler d1 execute`; an exact reservation is never widened or treated as permission for another billed snapshot. Only the pinned successor coordinator may reuse a still-maximum reservation, and only after its retained state chain proves the previous attempt stopped before D1 and acquires the exact pre-scan resume lease described below.

After deployment, translation/topic reconciliation, authenticated mutation cleanup, and all other release writes, prove protected-data counts never decreased, every sampled historical identity remains, and baseline columns were not removed. The operational outbox may grow or drain during this interval, but it must remain within its fail-closed capture cap and retain every baseline column:

```bash
pnpm cf:verify:historical-data-preservation -- \
  --verify-preservation \
  --confirm-production
```

Verification reads the expected `hmacKeyId` from the fully validated private baseline and retrieves exactly that Keychain item before any D1 operation. A missing, locked, denied, malformed, or mismatched item fails closed. Never generate a replacement for an existing baseline. A failed or indeterminate verification means the release is incomplete; do not replace its baseline or conceal the mismatch.

### One-release 2026-07-13 budget-rollover continuity bridge

The SEO translation import completed after the `2026-07-13T01:10:08.863Z` historical baseline, but its direct final preservation check was rejected before D1 execution: current account reads plus the cumulative release ledger and the verifier's conservative reservation projected `5,333,906` reads against the `4,000,000` lag-safe ceiling. Do not retry around the ledger, lower the reservation, generate a new HMAC secret, or overwrite the predecessor evidence. This release has one tracked, fail-closed rollover policy bound to commit `054ecb541cacec420f09e535ed4b5e79c46d1dfe`, source fingerprint `ecafef85eedc234608d5034801a24167339abc2a2026ca425a2d6c056277382f`, the exact baseline and ledger hashes, candidate `73a5299f-fd1f-47df-84a1-adf4bae573ce`, and repair run `5cde8cb4-87d5-4bc9-8f05-cc93ade2e446`.

Archive the predecessor while its original ledger day and 12-hour evidence window are still live. This phase reads only owner-local evidence and Git objects. It never invokes Wrangler, D1, or a Cloudflare API; a byte-exact replay is idempotent, while partial or divergent evidence fails closed:

```bash
pnpm cf:verify:historical-data-continuity -- \
  --archive-predecessor \
  --confirm-production \
  --confirm-budget-blocked-rollover
```

The rollover requires the exact predecessor HMAC key, not merely a new key with the same purpose. Its expected non-secret key ID is pinned in source and the archived predecessor is byte/hash/policy/ledger validated before retrieval. If an approved secure copy of the original 64-character key is recovered, escrow it from an owner-only file; the command validates it against the archived predecessor before a non-overwriting Keychain write and never prints the secret:

```bash
pnpm cf:verify:historical-data-continuity -- \
  --escrow-recovered-predecessor-key \
  --recovered-key-file /absolute/path/to/owner-only-recovered-key \
  --confirm-production \
  --confirm-budget-blocked-rollover
```

Do not use `echo`, a secret-valued command argument, standard input, or an environment variable for recovery input. The normalized absolute file path is non-secret; the command opens it with no-follow semantics, requires current-user ownership and mode `0600`, rejects extended ACLs, validates an unchanged descriptor, and never prints the contents. It deliberately does not delete the file: after exact Keychain readback, retain that plaintext only in approved encrypted recovery storage or remove it through the owner-approved secure disposal process before continuing. The Keychain item explicitly trusts `/usr/bin/security`; keep the login Keychain locked whenever the release operator is unattended and restrict access to the macOS account. If the exact key is unavailable, stop before every production D1 read/write, migration, upload, activation, or deploy; do not generate or substitute a new key. Finish, commit, push, and locally validate the exact successor source before recapture. On `2026-07-14`, capture the successor as soon as the D1 budget resets and no later than `01:10:08.863Z`, so the two snapshots remain at most 24 hours apart. The ordinary capture replaces the canonical baseline only after the predecessor archive is durable:

```bash
pnpm cf:check:d1-migration-budget -- --confirm-production
pnpm cf:apply:d1-runtime-migrations -- --confirm-production
pnpm cf:verify:d1-runtime-migrations -- --confirm-production
pnpm cf:verify:historical-data-continuity -- \
  --capture-successor \
  --confirm-budget-blocked-rollover \
  --confirm-production
pnpm cf:verify:historical-data-continuity -- \
  --verify-rollover \
  --confirm-production
pnpm cf:preflight:deploy
```

Successor capture maintains an owner-only, hash-chained state machine beside the archived predecessor. The exact scan-authorization marker is durably written at the last pre-D1 cut line, after the cumulative read reservation and before the snapshot runner. A retry with prepared or complete evidence finalizes or replays the same report without loading the Keychain and without another D1 scan; finalization may finish just after the capture window, but the ordinary 12-hour final-verification freshness limit still applies. A fresh capture can begin only inside the pinned UTC window. Claims are immutable and are never unlinked or replaced: completion retains the exact claim as permanent chain evidence, eliminating cleanup/acquisition races. A Keychain, validation, or interrupted first-publication-sync failure before D1 retains its exact run ID. After proving the prior owner process is gone (or after the same process has unwound the failed attempt), resume only that claim with:

```bash
pnpm cf:verify:historical-data-continuity -- \
  --capture-successor \
  --resume-successor-pre-scan-run <exact-run-uuid> \
  --confirm-budget-blocked-rollover \
  --confirm-production
```

The failure message prints the non-secret exact run UUID. Resume revalidates the source, predecessor, HMAC key, capture window, owner identity, state inode/hash chain, and existing budget reservation before reaching D1. Cross-process recovery uses a bounded append-only lease chain (`01` through `08`): the latest owner must be this already-unwound process or provably exited, every lease hashes the claim and prior lease, all contenders race for the same deterministic `O_EXCL` slot, and only the exact latest current-process owner may authorize or finalize a scan. An exact `nlink=2` interrupted scan-authorization publication remains explicitly classified as definitely pre-D1; resume first makes that same inode durable and then uses it at the last pre-D1 cut. A normal mode-`0600` scan authorization without prepared evidence remains indeterminate because D1 may already have started, so automatic rescan is forbidden. Never delete, rename, replace, or hand-edit any successor state file.

The rollover verifier requires a clean pushed successor, the exact next UTC day, a fresh live-ledger successor baseline, the retained HMAC key, byte-exact predecessor archive evidence, and a gap no longer than 24 hours. For every protected dataset it applies the direct verifier's same guarantees: counts cannot decrease, every predecessor column identity must remain, and every predecessor HMAC sentinel must still occur in the successor's bounded identity set. The pinned V1 predecessor did not capture the not-yet-introduced operational outbox, so inventing predecessor job-row preservation would be false evidence. Instead, this one-release bridge requires the post-`0016`, pre-activation successor snapshot to prove the complete outbox schema exists and its row count is exactly zero. Its report records that job-row preservation is false by design. Future V2 preservation snapshots may contain live outbox jobs and compare schema only, allowing verified jobs to drain normally. The verifier writes a private source- and baseline-bound continuity report. Deploy preflight rejects a missing, stale, failed, wrong-source, wrong-baseline, wrong-policy, wrong-manifest, nonempty first-release outbox, symlinked, or broad-permission report. This bridge is not a general bypass and must not be copied to another incident.

## Additive D1 runtime migrations 0013-0016

Before deploying this revision, apply all four tracked supplemental migrations in order. `0013` adds the bounded runtime indexes on `rate_limit_windows(reset_at)`, `ai_runs(created_at)`, and `ops_events(user_id)`; the last one keeps disposable validation cleanup from scanning the operations table. `0014` reads the durable all-time user, chat, message, and AI-run counts once and upserts the single `native-admin-totals-v1` `app_metadata` row. It excludes only the reserved `@inspirlearning.invalid` validation owner while retaining NULL/orphan historical chats and their child rows. `0015` adds nullable `completion_token` and `completion_message_id` columns to `activity_runs` plus one exact unique partial index for each non-NULL receipt. `0016` adds the checked `user_memory_settings.summary_suppression_mask`, creates the initially empty `memory_vector_cleanup_outbox` durability table and its single due index on `(next_attempt_at, created_at, vector_id)`, then performs one bounded compatibility backfill from known canonical or bare suppression-feedback section IDs. The backfill never scans summary JSON, changes no saved memory/chat content, preserves every existing settings preference, and creates default settings only for an affected existing user who has no settings row. Its final statement writes the fixed `runtime-migration-0016-complete` marker; marker absence proves the file did not finish and is classified as partial rather than applied. Historical arbitrary summary IDs are preserved lazily by the runtime before synthesis or derived-summary invalidation. Local preview setup applies every unapplied supplemental migration automatically.

Use this exact production order: daily Free-plan budget reservation, guarded migration wrapper, read-only verification, then Worker preflight/deploy. The budget gate sums the current UTC day's D1 analytics across every database in the account, rejects truncated Query Insights, and admits work only below the four-million-read and 80,000-write safety ceilings that retain one million reads and 20,000 writes of hard-limit headroom. It initially reserves the migration operation's conservative one-million-read and 50,000-write maximum, bounds `activity_runs` while projecting all three `0013` indexes, both `0015` partial unique indexes, and three full `0014` snapshot-read passes. For `0016`, it also takes capped cardinalities for settings, suppression feedback, and distinct affected users, projects the compatibility backfill's reads, reserves two billed writes per affected user for the worst-case missing settings row plus its implicit `TEXT PRIMARY KEY` index entry, and adds the conservative fixed allowance for the additive schema, completion marker, and exact read-only verification. Existing-row updates cost no more than that reservation. It refuses any cardinality at its cap or any inconsistent affected-user count. The owner-only UTC-day ledger accounts cumulatively for release operations even while Cloudflare analytics lag, and rejects a stale day instead of rolling a reservation into the next day. It refuses before cardinality SQL when the daily allowance is exhausted. Wait for the next `00:00 UTC` reset if it fails; do not bypass it or move this release to a paid plan.

```bash
# 1. Account-wide daily budget and bounded 0013-0016 projection.
pnpm cf:check:d1-migration-budget -- --confirm-production

# 2. Create durable diagnostic evidence, then apply the exact tracked files in order.
pnpm cf:apply:d1-runtime-migrations -- --confirm-production

# 3. Prove the complete 0013-0016 state before any Worker upload/deploy.
pnpm cf:verify:d1-runtime-migrations -- --confirm-production
```

Never run the four migration SQL files with ad-hoc Wrangler commands. The wrapper requires the fresh exact budget report and its live ledger reservation, records and fsyncs the Time Travel bookmark, database identity, source fingerprint, migration hashes, projection, and forward-correction-only policy before its first write, and verifies exact state after each migration. It serializes no destructive restore recipe. It refuses partial or stale state and never blindly retries an ambiguous `0015` or `0016` response. The separate verifier is read-only and requires explicit production confirmation. It proves both `0015` columns, both exact unique partial index definitions, all three `0013` index definitions, one valid `0014` snapshot whose four counts are non-negative integers, the exact checked `0016` suppression-mask column, all 18 exact outbox columns and defaults, the complete outbox table/check-constraint SQL, exactly one explicit outbox index with the required three-column due order, and the exact final `0016` completion marker with a positive server timestamp. The marker is part of `0016` exact-state classification, so schema without a successfully completed backfill cannot authorize activation. The verifier atomically writes fresh, source-fingerprint-bound, mode-`0600` evidence under the active backup directory. `pnpm cf:preflight:deploy`, `pnpm cf:upload`, and `pnpm cf:deploy` reject missing, stale, non-regular, symlinked, wrong-mode, wrong-source, incomplete, or non-ok evidence, so the Worker cannot activate before `0016`. Finish, commit, and push the exact source before starting this sequence; any later tracked-source change invalidates the release evidence and must be resolved before deployment. None of these commands uses `d1 export`.

The production migration, standalone source sync, topic sync, Worker deploy, translation maintenance, authenticated validation, and main-Worker rollback all use the same D1-backed production exclusion. The three D1 child scripts refuse direct remote execution unless their parent wrapper proves the exact live owner. The parent revalidates the sole active Worker and repository fingerprint after acquisition, renews the lease while the child runs, holds it through the child report and authoritative readbacks, and releases only after final certification. A crashed non-validation operation leaves a bounded lease; after D1 declares it expired, the next guarded operation replaces it atomically. Do not invoke the underlying TypeScript files or raw Wrangler mutation commands directly.

All four migrations are additive. A Worker rollback leaves their table, columns, indexes, and snapshot in place; do not drop them during an application rollback.

## Translation gate

The repository owns the curated translation bundles used at build time. D1 mirrors every current source namespace and stores the audited payload repairs used by the former runtime. Run the read-only repair verifier and require complete bundles for every language on the surfaces this Free deployment publishes globally:

The four bootstrap-language site corpora are tracked in full. Other languages track the three globally materialized site surfaces, and main-app translations use the compact tracked `translations/static-main-app` representation. Full main-app editing packs remain ignored workbench files and must never affect release identity. A clean checkout must reproduce the exact 691 site rows plus 69 main-app rows used by the repair.

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

The repair must fail closed unless source extraction, all tracked curated packs, Unicode normalization, field validation, D1 statement/file limits, and the account-wide Free-plan budget all pass. Before its first target/snapshot D1 read it reserves the conservative maximum in the one cumulative UTC-day release ledger under a reservation bound to the exact source fingerprint, candidate, immutable plan, and release-preflight run ID. It deliberately retains that maximum through target discovery, source planning, import, byte-exact post-import verification, candidate restoration, maintenance-marker cleanup, and exclusion release; the lower planning forecast must never be presented as exact billing. Wrangler JSON metadata meters every read-only query and a confirmed import, while missing import metadata keeps the maximum reservation rather than guessing. Immediately before import the repair revalidates the candidate, source, immutable repair plan, unchanged maximum ledger reservation, and UTC day. It never uses `d1 export`, because exports block database requests. Instead it validates a current Time Travel bookmark and writes a unique mode-`0600`, exclusively-created, fsynced diagnostic record plus an unresolved-operation marker before its first import. It applies one atomic SQL file and byte-verifies every resulting row. A definite mismatch, billing overflow, or indeterminate verification leaves maintenance active and requires a reviewed forward correction. Destructive whole-D1 Time Travel restore is unsupported on Free because the runtime cannot prove cross-store quiescence. A new repair refuses to start while an unresolved marker exists. Never run it routinely when the same hashes already pass.

The repair also persists an exact cross-workspace maintenance marker in production D1 while it still owns the global exclusion and before it activates the maintenance Worker. Ordinary deploy, validation, rollback, and release-maintenance wrappers refuse that marker even after the original lease expires. After a reviewed forward correction (or when evidence proves no D1 write occurred), resolve only the exact recorded run with:

```bash
pnpm cf:resolve:production-maintenance -- \
  --confirm-production \
  --confirm-reviewed-forward-correction \
  --repair-run-id <exact-repair-run-uuid>
```

The resolver is the sole marker bypass: it exact-reads the D1 state, acquires a recovery exclusion without stealing a live owner, accepts only the recorded candidate or maintenance version, restores the recorded candidate to 100%, proves that exact version healthy and unfrozen, durably writes fail-closed evidence, atomically clears the exact marker while still owning the lock, releases, and only then promotes the report to success. The explicit reviewed-forward-correction confirmation is required even when review proves that the imported canonical payload is already correct and the failed invariant itself needs correction. After production resolution succeeds, the resolver binds the successful production report, exact unresolved marker, and prewrite evidence before retiring the local unresolved marker. If a process using an older resolver (or a crash after production resolution) leaves only that local marker behind, finish the same evidence-bound step with:

```bash
pnpm cf:resolve:production-maintenance -- \
  --finalize-local-resolution \
  --confirm-production \
  --confirm-reviewed-forward-correction \
  --repair-run-id <exact-repair-run-uuid>
```

This continuation never changes translation or user rows. If a successful resolution report already exists, it requires authoritative absence of both production maintenance and the validation lock before retiring local evidence. If only the durable preliminary report exists because the prior resolver stopped after clearing the maintenance marker, it acquires a fresh candidate/source-bound recovery exclusion. A still-live crashed owner is never stolen; after D1 declares that lease expired, the normal compare-and-swap acquisition may replace it. The continuation then proves the recorded candidate is sole, healthy, and unfrozen, exact-releases its recovery exclusion, promotes the production report, and retires the matching local marker idempotently. Every path requires matching mode-`0600` unresolved, prewrite, release-preflight, and resolution evidence. Never delete either the D1 or local marker or deploy around it by hand.

For this one-release 2026-07-13 budget-rollover cutover, the standalone source synchronizer is
explicitly forbidden. Do not invoke the `cf:sync:site-translation-sources` package script during
this release. The guarded production wrapper mechanically rejects that operation before reading
source state, the active Worker, or acquiring the D1 exclusion; the package entry is intentionally
non-executable for this rollover. Source reconciliation is part of the candidate-bound main atomic translation repair,
so running the standalone path would spend from the same cumulative UTC-day ledger without the
required candidate/deploy continuity. The tool remains available only for a future, separately
reviewed steady-state runbook after this one-release restriction is removed.

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
- exactly 280 complete legacy translation API assets: 70 main-app responses and
  210 published site responses, with zero `.incomplete` assets and an exact
  path-set match to the curated availability manifests;
- no more than 5,000 total asset files, with the report count, generated-path
  hash, complete symlink-free asset-tree file/byte/hash manifest, individual
  file-size bound, source-hash scan, and secret scan all matching.

`pnpm cf:preflight:deploy` rejects dirty or unpushed Git state, stale source-fingerprinted gate evidence, a missing/stale/mismatched materialization report or actual asset tree, missing or incorrect D1/Vectorize/profile-R2/Queue/cron bindings, any OpenNext incremental-cache R2 binding, an extra Worker-first route, paid CPU configuration, missing Static Asset 404 boundary, missing translation/chat/admin artifacts, missing rollback-safe Durable Object infrastructure, or a main Worker that imports OpenNext. The deploy wrapper validates the freshly rebuilt tree again immediately after materialization and compares that same manifest with the immutable artifact capture immediately before Wrangler runs; a previous build's green report cannot authorize a new deployment.

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

## Post-deploy Vectorize readiness gate

Before the topic, translation, or authenticated-validation paths can mutate D1, Worker versions,
Worker secrets, or Vectorize-backed application state, capture a fresh read-only Vectorize
attestation against the exact deployed candidate:

```bash
pnpm cf:verify:vectorize-readiness -- \
  --remote \
  --confirm-production \
  --candidate-version <exact-100-percent-worker-version-uuid>
```

This command is strictly read-only and records all five remote reads in order: `wrangler
deployments status` before the Vectorize inspection, `wrangler vectorize get`, `wrangler vectorize
info`, `wrangler vectorize list-metadata-index`, and a second `wrangler deployments status`
readback. It never creates an index, creates a metadata index, inserts a vector, or changes
Cloudflare state. It fails unless the clean local `HEAD` equals its pushed upstream, the private
deploy report and immutable source/Worker/config/asset evidence bind the exact candidate, both
deployment readbacks keep that candidate alone at 100%, `MEMORY_VECTORIZE` binds the exact
`inspirlearning-memory-prod` index, the immutable remote configuration is exactly 512 dimensions
with cosine distance, the index contains at least one vector, and the remote metadata indexes are
exactly `userId:string` and `chatId:string`, matching Wrangler's lowercase API contract. Success durably writes fresh, source- and
candidate-bound owner-only mode-`0600` evidence under the active backup directory.
Topic sync, translation repair, and authenticated production validation each revalidate this
evidence before their first mutation. It expires after 30 minutes; rerun this same read-only command
against the unchanged candidate when needed.

## Atomic managed-topic reconciliation

Immediately after the Vectorize gate, retire the removed arena and reconcile the tracked topic
catalogue with one guarded transaction:

```bash
pnpm cf:sync:topic-seeds -- \
  --remote \
  --confirm-production \
  --candidate-version <exact-100-percent-worker-version-uuid>
```

This order is a Free-plan safety invariant. Topic sync first reserves its conservative maximum of
2,500,000 reads and 50,000 writes, then refines that reservation to its exact snapshot-derived cost
before import. Translation detection/repair retains its full 2,500,000-read and 50,000-write
maximum through completion. Starting translation first would make the later topic maximum project
5,000,000 reads and 100,000 writes, which the cumulative release ledger must reject against its
4,000,000-read and 80,000-write lag-safe ceilings. Running topic sync first and refining it preserves
the only admissible headroom; do not reverse these sections or split them across untracked commands.

The command requires `--candidate-version <exact-100-percent-worker-version-uuid>`. Its parent validates the same clean pushed Git/source/Worker/config/assets/version/readiness identity before acquiring the production D1 exclusion, and the child repeats that gate before its first D1 query and immediately before import. It checks the cumulative UTC-day D1 release ledger before its first D1 SQL, records a diagnostic Time Travel bookmark and explicit forward-correction-only policy, executes one atomic SQL file, and exact-verifies every managed, retired, and untouched topic plus both seed metadata rows. Only after that verification succeeds does it durably write the owner-only topic-reconciliation attestation consumed by translation work. It serializes no destructive restore recipe. A lost Wrangler response succeeds only after exact verification; a definite mismatch or indeterminate read requires a reviewed forward correction. It archives only `ai-game-arena` and stale slugs from the previous repository-owned `topic_seed_slugs` manifest; it never changes an existing topic ID or created timestamp and its SQL never reads or writes account, user, chat, message, session, or memory rows. If this command fails, the release is incomplete: roll back the candidate Worker before continuing and use a reviewed forward correction for D1.

## Post-deploy translation reconciliation

Only after managed-topic reconciliation has completed and refined its ledger reservation, run the
guarded read-only production translation drift detector against the exact deployed source. It
requires the fresh Vectorize evidence and successful topic-reconciliation attestation for the same
clean pushed source and candidate before its first D1 read. It performs only bounded `SELECT`/`WITH`
statements and returns nonzero when a repair is required. Before those reads it durably replaces any
prior translation success with an owner-only `checking` attestation, so a crash or indeterminate
result cannot authorize authenticated validation. Only exact reconciliation replaces that pending
record with successful, source/candidate/topic-bound evidence:

```bash
pnpm cf:d1:repair-seo-translations -- \
  --remote \
  --verify-only \
  --confirm-production \
  --candidate-version <exact-100-percent-worker-version-uuid>
```

If a repair already reserved its maximum but failed before durable prewrite evidence, maintenance-state creation, maintenance activation, Time Travel, or import, do not delete or edit the UTC-day ledger. While the original candidate is still the sole healthy version and the same UTC billing day is active, refine only that exact aborted preflight:

```bash
pnpm cf:d1:repair-seo-translations -- \
  --refine-aborted-prewrite-reservation \
  <exact-release-preflight-timestamp-and-uuid> \
  --confirm-production \
  --confirm-prewrite-abort
```

This recovery requires a clean pushed tree and owner-only, nofollow release evidence. It recomputes the immutable plan; accepts only the exact run-bound reservation (or a tightly timestamp-bound legacy reservation); rejects any prewrite/unresolved/maintenance evidence; holds the shared production exclusion; proves the original candidate healthy and unfrozen before and after a deterministic read-only drift check; requires `rows_written` to be exactly zero in every D1 result; and retains the summed billed reads plus the full validation-lock read/write allowance when refining the maximum. It writes mode-`0600` prepared evidence before the ledger transition and promotes it only after exact lock release. A prepared crash replay performs one bounded read-only maintenance/lock-absence check before the remaining local ledger/evidence transition; a complete replay is local-only and idempotent, including after UTC rollover. If any prerequisite is not exact, leave the conservative maximum in place and wait for the next UTC day; never hand-edit the ledger. Run this recovery before deploying a different candidate or collecting new source-bound release evidence.

Only when that detector reports exact, determinate drift, run the guarded repair against the already deployed and committed candidate:

```bash
pnpm cf:d1:repair-seo-translations -- \
  --remote \
  --confirm-production \
  --confirm-native-write-freeze \
  --candidate-version <exact-100-percent-worker-version-uuid>
pnpm exec wrangler deployments status --name inspirlearning --json
```

The repair refuses missing or stale Vectorize readiness evidence, missing/current-topic reconciliation evidence, and a missing, stale-source, non-`0600`, symlinked, upload-only, unsuccessful, or version-mismatched Worker deploy report. Before any repair D1 work it replaces translation success with a fail-closed `checking` attestation. It re-hashes the complete source/Worker/config/asset set before and after the maintenance upload and again immediately before activation, and also proves the captured candidate is still the sole version at 100%. The command then moves 100% traffic to the uniquely tagged, framework-free maintenance version: static pages remain available, while API, Queue, cron, and D1 mutation paths fail before touching D1. After exact post-import verification it restores 100% traffic to the captured candidate UUID rather than compiling or deploying current local source, revalidates that final release sequence, writes the successful translation attestation, and only then allows authenticated validation. Lost Wrangler responses are resolved from repeated authoritative version/deployment readback. OpenNext and the retired cache R2 path cannot enter either transition. Continue using the original candidate UUID for every following production gate.

## Production verification

Before any mutation or Cloudflare API-token use, the authenticated verifier sends a bounded public `GET /api/health` with a non-secret readiness nonce, the exact expected-version override, and the same random header used by the HTTP-tail filter. Both JSON Tail streams must independently capture that exact clean `200` invocation on the expected Worker version, and the health body must report the same version; Wrangler's pretty-only connection diagnostic is not readiness evidence.

Use the single candidate-version UUID reported at 100%. Authenticated production verification is mandatory and uses five temporary Worker secrets. The wrapper generates `E2E_TEST_MUTATION_RUN_ID` and a hard `E2E_TEST_AUTH_EXPIRES_AT`, manages `E2E_TEST_AUTH_REQUIRE_EXISTING=1`, and installs the operator-supplied `E2E_TEST_AUTH_EMAIL` and `E2E_TEST_AUTH_SECRET`. `E2E_TEST_AUTH_EMAIL` must be the exact lowercase email of an existing configured admin. The historical-account action fails with `409` if that user is absent, reuses the existing ID without updating any user/profile field, confirms `isAdmin` from server configuration, and never creates a user or admin grant. A separate candidate/run-bound action creates only a deterministic non-admin `@inspirlearning.invalid` disposable user for mutation validation. An exact-session, live-capability action may then grant only that marked disposable identity temporary database-admin status so the real admin mutation APIs can be tested; it cannot elevate the historical account or an arbitrary email. Keep `ADMIN_EMAILS` unchanged.

Run the guarded wrapper below instead of installing or deleting temporary secrets by hand. Before its first secret write, it proves all five temporary names are absent, validates fresh Vectorize and translation-reconciliation success evidence, the candidate's clean pushed source/private deploy evidence, and sole 100% deployment, and writes a private, fsynced recovery manifest under the active backup directory. If either 30-minute readiness window elapsed during reconciliation, rerun the read-only Vectorize and translation verification commands against the unchanged candidate first. The manifest binds the candidate, pushed source fingerprint, immutable Worker resources, baseline secret names, mutation run, 90-minute capability expiry, historical-session purposes, installed-secret progress, cleanup proofs, and the cumulative D1 lock budget. Each secret operation must produce only an exact secret-triggered version of the same immutable release. The wrapper installs the route capability last, samples the first real requests under tail, runs the outcome/smoke/private read-only Playwright and disposable mutation gates, then exact-cleans and independently verifies both historical validation sessions and the disposable graph before removing the route capability first and all remaining temporary secrets. Immediately before the one explicit real post-turn Queue publish, the mutation gate also writes owner-only recovery evidence containing the deterministic revision-bound `t:<user-message-uuid>:<16-hex-revision>` Vectorize ID and its candidate/run/source/chat bindings; a publish cannot precede this durable evidence.

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

Recovery revalidates the current source fingerprint, deploy evidence, original candidate-bound Vectorize and translation attestations, immutable active Worker resources, exact secret set, and stored D1 budget before changing remote state. It does not require the original candidate to be active while a temporary secret-derived version legitimately owns traffic, and it does not let either attestation's 30-minute freshness window block emergency cleanup; the recovery manifest and active-version sequence separately bind every secret-derived version to that immutable candidate. If the exact memory-recovery sidecar exists, recovery requires its authenticated-version/run/source/chat binding and deletes only the one recorded deterministic disposable-test vector ID `t:<user-message-uuid>:<16-hex-revision>`—never a metadata-selected set, another user's vector, or the index. It proves that exact ID absent before hidden D1 cleanup, then repeats bounded exact-ID deletion/absence polling after D1 cleanup to fence a late in-flight Queue upsert. The sidecar is removed only after the post-D1 absence proof; if no sidecar exists, a crash before the authenticated-version manifest update safely falls back to the current secret-derived version and performs no Vectorize mutation. Recovery reacquires or renews only the manifest's same global lock identity, holds it through this known-ID cleanup and the complete disposable sweep, deletes secrets in the guarded order, proves the route is disabled, releases the lock with an absent readback, and retains both recovery records on any indeterminate result. A recovered release must still rerun the full authenticated production validation before acceptance.

The outcome soak authenticates through the hidden migration route, verifies the exact admin identity without changing that user, and keeps its returned session cookie only in memory. Historical-account production probes are GET-only for profile, chat list/detail, account topics, memory, and admin state. The wrapper then authenticates the candidate/run-bound disposable user, grants only that exact marked session temporary admin status, proves successful `POST /api/admin/users`, successful `POST /api/admin/topics`, and independent account-topic readback, then exact-deletes the topic and admin grant and requires `admin_users=0` and `topics=0` in hidden inventory. Temporary validation-admin authority is bound to the exact runtime version, mutation run, deterministic identity, live capability expiry, and installed secret; it permits only the exact self admin mutation and deterministic topic fixture, fails closed after any binding disappears or expires, and does not restrict ordinary admins. Every validation admin write includes the exact active marker and user identity in its D1 statement, and its ops event commits in the same batch. Generic cleanup first atomically changes that exact marker to its deterministic fenced state and revokes every exact disposable session in one two-statement D1 batch, so writes ordered after the fence fail their marker/session authorization guards. It then takes one fresh topic/ownership snapshot and executes exactly one final serialized D1 batch: 29 statements in the topic-present worst case, comprising five unconditional set-wise legacy/exact vector capture-or-fence statements, the complete owner-data sweep, and guarded account/session/user/non-fence/fence finalization. Every expected vector ID must resolve to an outbox row with the exact same owner, source namespace, and source row before its source or owning chat parent can be removed; a foreign-owner or foreign-source collision fails closed without rewriting the existing outbox or deleting the source, chat, user, or fence. Any owner-scoped outbox row blocks identity and fence finalization until explicit Vectorize absence verification drains it and an HMAC-authorized cleanup retry succeeds. The verified topic-present cleanup request uses at most 35 D1 queries, below the Workers Free 50-query invocation limit. The fenced marker remains available for idempotent crash recovery until final zero-residue deletion. Topic creation atomically stores a second ownership marker whose ID is the created topic UUID. Cleanup binds that exact UUID, every stable topic field, and both ownership markers; it refuses while chats, chat summaries, memory turns, or response-cache rows reference the topic. A slug collision, replacement UUID, missing marker, dependency, or mismatched row fails closed, and generic recovery preserves the identity until the exact residue can be removed. The same wrapper production-proves profile mutation, current SSE chat plus explicit finalization, legacy text chat plus server-side persistence, memory create/update/list/delete, completed quiz and flashcard result experiences, and saved result readback. Automatic Queue enqueue remains suppressed for the disposable account, but the verifier explicitly publishes one exact finalized `memory.post_turn.v2` job while its source rows exist. A separate version-only tail must prove one batch-size-one `stored` Queue invocation and same-invocation vector indexing below 8 ms CPU; an authoritative known-ID read must prove vector presence before a second current-SSE chat proves at least one hydrated prior turn. Cleanup first uses the authenticated owned-chat delete/Vectorize path, proves the source chat is `404`, then performs disposable D1 cleanup and bounded known-ID absence polling. Hidden cleanup refuses to erase the source when owned vector cleanup is unproven. An ignored version override, identity substitution, indeterminate readback, vector residue, or nonzero D1 inventory fails the release. Every correlated HTTP invocation must name the exact Worker and authenticated-validation version, report `truncated: false`, contain a real empty exceptions array, contain no warning/error log, have an `ok` outcome and finite non-negative CPU sample, and use less than 8 ms CPU. If the wrapper exits nonzero, treat the release as failed: use the private manifest and `--recover` when present, and independently inspect `wrangler secret list --name inspirlearning` for all five names: `E2E_TEST_AUTH_SECRET`, `E2E_TEST_AUTH_EMAIL`, `E2E_TEST_MUTATION_RUN_ID`, `E2E_TEST_AUTH_EXPIRES_AT`, and `E2E_TEST_AUTH_REQUIRE_EXISTING`.

HTTP evidence alone is insufficient because Queue and Scheduled invocations have separate Free-plan CPU limits. The guarded wrapper therefore records real stored-Queue/vector-indexing and semantic-retrieval evidence against the temporary authenticated-validation version. Every explicit cleanup wake receives a unique mutation-run-bound reason. The version-only tail must capture exactly one same-reason start marker and one identity-matched terminal for each delivery, retain all attempts through shutdown, and settle the continuation/retry chain at a well-formed processed result with `pending: 0` within the ten-minute evidence window. A deferred or `pending: 1` attempt is not success by itself, and a caught failure, CPU-killed attempt, later failure, wrong version, non-`ok` outcome, truncation, exception, warning, malformed log, batch size other than one, missing CPU, CPU at or above 8 ms, Tail overload, sampling, dropped-event diagnostic, connection loss, or reconnect fails closed even if a later retry succeeds. The private report records the run, reason, capture timestamps, attempts, message IDs, terminal states, pending state, CPU samples, and capture-loss result. It then automatically runs the existing stale-job Queue probe again after the final secret-free version is active. Those version UUIDs differ only because their secret/configuration sets differ: the wrapper proves and reports that both share the exact immutable source, Worker artifact, non-secret bindings, and asset identity. The stale probe starts a version-only tail without HTTP filters, resolves the existing Queue ID read-only, and pushes one syntactically valid job whose random user/chat IDs cannot exist. The consumer performs only its normal indexed ownership/settings reads, acknowledges `stale_job`, and writes no D1 row. The evaluator requires the exact Queue, batch size one, final secret-free version, structured correlation log, clean outcome, no exceptions/resource-limit logs, and CPU below 8 ms. The command below is also available for an independent repeat against that reported final version.

For the final secret-free stale-job probe, the verifier first establishes a complete JSON-record boundary in the live Tail stream and uses that stream position—not a comparison between workstation and Cloudflare clocks—as the pre-publish checkpoint. Every memory-Queue invocation after that checkpoint is globally checked for the exact version, batch shape, clean outcome, no truncation/exceptions/warning/resource log, and CPU below 8 ms, so a bare CPU-killed attempt cannot disappear behind a successful retry. Exact probe terminals are correlated by the random nonexistent user ID: the evaluator requires exactly one well-formed first-attempt (`attempts: 1`) `stale_job` success, rejects any retry count, correlated failure, or malformed probe log, and ignores unrelated healthy user jobs for correlation and quiet-time purposes. The 65-second quiet window starts when the verifier first observes the exact success, never from the Worker event timestamp, so a late Tail delivery cannot settle immediately. It then sends one new, unique expected-version health marker and requires that exact clean invocation through the same Tail; this one-shot post-settlement marker cannot be rescued by retrying after a silent WebSocket gap. Only explicit structured Tail control types and precise Wrangler stderr loss/reconnect/sampling diagnostics count as capture loss; those words inside an application URL or log do not. The Worker version is checked again after observation and after shutdown. Intentional shutdown drains UTF-8 safely assembled final stdout and stderr, filters only Wrangler's exact benign `Stopping tail...` line, and losslessly parses every non-whitespace stdout byte as a complete top-level JSON record before re-evaluating the capture. A trailing partial/malformed record, unexpected Tail exit, or SIGKILL fallback invalidates the proof.

```bash
pnpm cf:verify:background-outcomes -- \
  --queue \
  --expected-version <final-secret-free-worker-version-uuid> \
  --confirm-production
```

Observe—not manufacture—the real daily Scheduled invocation. Start this shortly before 03:00 UTC and leave the steady-state cron set unchanged. The production handler deliberately calls `ScheduledController.noRetry()` before work: a failed invocation is not replayed implicitly, while the durable cleanup outbox, Queue wake chain, and next daily invocation remain recovery backstops. The evaluator collects every `0 3 * * *` record received by the Tail before validating event shape, so an extra-key malformed failed duplicate cannot hide behind one exact success. Every attempt must use the requested UTC occurrence and final version; any duplicate, malformed event, failed outcome, exception, warning/resource log, CPU sample at or above 8 ms, or post-observation version change fails the release. It requires exactly one exact-shape synthesis-enqueue log with `due === queued <= 25`, `failed: 0`, `skipped: null`, and no extra fields, plus exactly one exact-shape `native_memory_vector_cleanup_scheduled` log. For `pending: 0`, cleanup evidence must have `nextDelaySeconds: null`, `deleteRequested: 0`, and `claimed === verifiedAbsent`; for `pending: 1`, requested-plus-verified work cannot exceed claimed work and a null delay is the runtime's leased-row signal. Missing, duplicate, extra-field, over-bound, or internally unaccounted success logs fail closed. The same local 65-second post-observation settlement, one-shot same-Tail health marker, lossless final JSON parse, and drained-capture re-evaluation apply to Scheduled evidence. Queue and Scheduled wall times must be finite and non-negative but currently have no acceptance ceiling; this is a documented residual because CPU exhaustion is the Free-plan outage gate, while an anomalously long otherwise-clean invocation remains visible in the private report for operator review. There is no production-only manual Scheduled dispatch, and this runbook never installs a temporary cron.

```bash
pnpm cf:verify:background-outcomes -- \
  --scheduled \
  --scheduled-day <YYYY-MM-DD> \
  --expected-version <final-secret-free-worker-version-uuid> \
  --confirm-production
```

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
- the batch-size-one Queue consumer and real daily Scheduled invocation each have exact final-version `ok` tail evidence below 8 ms CPU;
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
