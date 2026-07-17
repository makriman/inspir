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
- Static materialization derives the complete localized HTML path set from the
  tracked translation-availability manifest. It must never assume that every
  non-English language owns all 17 localized documents. The source-current
  selected no-site-promotion release admits exactly 245 localized HTML paths.
  A future finalized-Afrikaans branch may change that separately, but it is not
  operative for this release. The release gate consumes the regenerated
  manifest and fails on any missing, unexpected, stale, or differently counted
  path. That exact path set is hash-bound in `.open-next/assets`. The final
  asset tree fails closed above the 5,000-file internal release ceiling or
  Cloudflare's 25 MiB per-file limit, and its complete manifest is bound into
  materialization and deploy evidence. OpenNext cache totals and total raw
  Static Assets bytes are recorded as release observations, not admission
  caps: the cache is never uploaded and Cloudflare does not define a total raw
  Static Assets byte limit. Wrangler dry-run evidence separately proves the
  deployed Worker's compressed size.

## Historical-data preservation gate

### Future steady-state process (not the current `0016` release)

The ordinary process below is the future steady-state path, not the current incident release. In steady state, capture a privacy-safe production V2 baseline before the first release data mutation. The capture command generates one release-only 256-bit HMAC key, stores it as a non-overwriting macOS login-Keychain item whose account is the non-secret `hmacKeyId`, verifies the readback, and keeps the secret out of arguments, environment variables, reports, and command output. The login Keychain must be unlocked. **Do not run this ordinary capture for the current `0016` release; use only the accepted fresh-boundary coordinator in the next section.**

```bash
pnpm cf:verify:historical-data-preservation -- \
  --capture-baseline \
  --new-hmac-key \
  --confirm-production
```

The baseline fails on an empty/wrong database and covers users, OAuth accounts, sessions, chats, messages, admin grants, user memories, activity runs, product events, profile-photo pointers, and immutable historical `game_results`. The retired game runtime is not restored; this evidence only prevents existing user result rows from being silently lost. Every new V2 baseline also requires `ai_runs` plus the saved-memory storage and provenance graph: memory source edges, settings, chat summaries, indexed turns and their message/topic edges, profiles, user summaries, synthesis runs, source feedback, and memory events. It separately records `memory_vector_cleanup_outbox` as a bounded, mutable operational dataset. Outbox job rows are deliberately not historical learner records: successful cleanup must be allowed to delete them, so ordinary post-deploy preservation compares its schema but never requires its count or job identities to survive. Ordinary direct readers and post-deploy verification accept V2 only. The current release's deploy preflight does **not** accept a standalone V2 baseline: it requires the fully validated canonical fresh-`0016` completion chain described below. The older ten-dataset V1 format remains readable only as immutable historical incident evidence; it cannot authorize this release or substitute for a current baseline. Evidence stores only counts, schema identities, and at most 16 HMAC sentinels per protected dataset—never raw IDs, emails, session tokens, chat text, memory text, vector IDs, or outbox ownership. Every count uses an inner `cap + 1` scan, both sparse profile-photo queries bound the underlying users scan before filtering, column schemas are capped, and the operational outbox scan stops at 10,001 rows. A separate `sqlite_master` inventory stops at 513 objects, rejects a 513th object or DDL over 4,096 bytes, and binds the exact `game_results` table and immutable-update trigger SQL hashes. Each game-result sentinel streams 14 typed, length-framed fields locally into HMAC; raw payloads and identifiers are never persisted. One logical V2 snapshot has a proven 740,996-row bound and retains its 750,000-row logical cushion. Because Cloudflare may transparently execute each read-only statement up to three times, admission reserves the full 2,250,000-row worst-case billable ceiling before D1. Every returned result set must contain an exact integer `meta.total_attempts` of `1`; missing, invalid, or retried-attempt metadata fails closed, retains the maximum reservation, and cannot produce or refine a report. Only a single-attempt response whose summed `rows_read` remains within the logical bound refines that reservation to exact metadata. V2 evidence and the operation's snapshot-plan hash bind all four values: logical snapshot bound, logical cushion, maximum automatic attempts, and worst-case billable reservation. Evidence is source-bound, owner-only mode `0600`, nofollow-read, and fsynced. The ordinary steady-state gate requires a baseline to be at most 30 minutes old. Ordinary final verification may reuse that exact baseline for at most 12 hours so a guarded deploy and live validation can finish, but its reservation remains bound to the exact source inside the one cumulative D1 ledger, which still forbids crossing the UTC billing-day boundary. Ordinary readers reject a missing, stale, wrong-source, wrong-ledger, malformed, symlinked, or broadly readable baseline.

An ordinary steady-state capture or verification reservation is single-use. If its source-bound operation already has either a maximum or exact reservation, repeating the command fails before `wrangler d1 execute`; an exact reservation is never widened or treated as permission for another billed snapshot. Only the accepted fresh-boundary coordinator may reuse a still-maximum reservation, and only after its retained state chain proves the previous attempt stopped before D1 and acquires the exact pre-scan resume lease described below.

For a future ordinary steady-state release, after deployment, translation/topic reconciliation, authenticated mutation cleanup, and all other release writes, prove protected-data counts never decreased, every sampled historical identity remains, and baseline columns were not removed. The operational outbox may grow or drain during this interval, but it must remain within its fail-closed capture cap and retain every baseline column. **Do not use this command for the current `0016` release; its exact fresh-successor verification command appears below.**

```bash
pnpm cf:verify:historical-data-preservation -- \
  --verify-preservation \
  --confirm-production
```

Verification reads the expected `hmacKeyId` from the fully validated private baseline and retrieves exactly that Keychain item before any D1 operation. A missing, locked, denied, malformed, or mismatched item fails closed. Never generate a replacement for an existing baseline. A failed or indeterminate verification means the release is incomplete; do not replace its baseline or conceal the mismatch.

For archived legacy-rollover incident recovery only—not for the current fresh-`0016` path—an independently recovered exact predecessor key must first be supplied through a normalized absolute, owner-only mode-`0600`, nofollow file and escrowed into the matching non-overwriting Keychain identity. Only then may the ordinary successor capture and rollover verifier run in their documented UTC window:

```bash
pnpm cf:verify:historical-data-continuity -- \
  --confirm-production \
  --confirm-budget-blocked-rollover \
  --escrow-recovered-predecessor-key \
  --recovered-key-file </absolute/owner-only/recovered-key>

pnpm cf:verify:historical-data-continuity -- \
  --confirm-production \
  --confirm-budget-blocked-rollover \
  --capture-successor

pnpm cf:verify:historical-data-continuity -- \
  --confirm-production \
  --verify-rollover
```

This recovery path cannot authorize the current release or retroactively prove the known lost-key interval.

### One-release accepted fresh trust boundary for migration 0016

The original `2026-07-13T01:10:08.863Z` predecessor HMAC key is unavailable and the former July 14 successor window is permanently expired. Therefore the identity continuity of the interval from that predecessor to the new cutover cannot be cryptographically re-proven. Do not claim otherwise, retry the expired rollover, substitute a new key for the old predecessor, overwrite old evidence, bypass the cumulative D1 ledger, or run raw migration `0016`.

This one-release path is authorized only after the owner explicitly accepts: “I accept the fresh trust boundary and understand that the 13 July-to-cutover identity interval cannot be cryptographically re-proven.” The command-line confirmation is the exact `--confirm-lost-key-fresh-boundary` flag. When the owner has explicitly authorized paid Cloudflare usage to avoid the former Free-plan UTC wait loop, the cutover commands must also include the exact `--confirm-paid-expedited-cutover` flag; that changes only the timing admission from the old reset window to same/next-UTC-day expedited timing and does not relax source, upload, D1 ledger, production-exclusion, HMAC, migration, or preservation proof requirements. It creates a new Keychain-backed HMAC identity and proves all 21 protected datasets—including immutable historical `game_results`—plus their schemas, counts, sampled identities, and exact immutable-result DDL across a new pre-`0016` predecessor and post-`0016` successor. The bounded pre-`0016` capture is exactly 62 result sets with a 730,738-row logical bound inside the unchanged 750,000-row cushion. That proof begins at the new predecessor; it is not retroactive evidence for the lost interval.

Before the first production read or write, finish every source change, run all local gates, commit, and push the exact clean source. Only after the owner has supplied the exact statement above, record that acknowledgement locally with the exact flag. This command performs no production access. It creates or exactly reuses one owner-only, single-link acceptance artifact bound to the clean pushed Git identity, complete source fingerprint, Cloudflare account, Worker, D1 database, one-release scope, exact statement hash, and known non-reprovable interval:

```bash
pnpm cf:accept:fresh-boundary -- --confirm-lost-key-fresh-boundary
```

Every supported remote release, production read/write, upload, staging, activation, and production-validation package command enters through `run-trust-bound-production-command.ts`, which nofollow-validates that exact current acceptance before starting a child process. Do not invoke the underlying TypeScript files or raw Wrangler commands. The deploy preparation is schema v2 and embeds the acceptance artifact SHA-256 and exact Git/source binding; upload evidence then carries the preparation hash through the rest of the append-only release chain. A missing, future-dated, changed-source, changed-Git, symlinked, hardlinked, broadly readable, replaced, or mismatched acceptance fails before remote access.

Create the upload-time deploy preparation and, while its 12-hour upload-eligibility interval is still open, upload exactly one inactive candidate:

```bash
pnpm cf:prepare:deploy
pnpm cf:upload
```

Preserve the owner-only upload evidence and record its exact target-candidate and service-baseline UUIDs. The target must differ from the baseline, receive no traffic, and remain absent from deployment topology; the baseline must remain the sole deployed version at `100%`. The upload evidence permanently hash-binds the exact preparation bytes that authorized the upload. Once the upload has occurred inside that preparation's original interval, the preparation becomes immutable release provenance rather than a rolling freshness gate: do not rebuild, recertify, create a replacement preparation, upload another candidate, or change source, Git, Worker, configuration, or Static Assets while the release proceeds.

For this Free-plan release, do not apply `0017`. Production user cardinality is above the fixed Free-plan write envelope for building the normalized-email expression index, and the runtime no longer depends on that index for normal Google linking. Instead, keep the existing exact `users(email)` index as the fast path, retain the bounded case-fold scan only as a miss fallback, and capture a source-bound read-only verifier showing `0017` is absent/deferred:

```bash
pnpm cf:verify:d1-runtime-migration-0017 -- \
  --confirm-production \
  --expect-absent-deferred-free-plan
```

Predecessor/start evidence consumes the owner-only `cloudflare/d1-runtime-migration-0017-report.json` as a same-day read-only absence proof. A partial index, stale source, wrong backup, write attempt, or applied-state report is not acceptable for this release.

Topic and translation reconciliation are also pre-predecessor prerequisites for this incident cutover, not Day-2 work. In the default Workers Free UTC-reset mode, capture uploaded-inactive Vectorize readiness, reconcile topics, and complete the staged read-only translation plan seal on an earlier—but still pre-predecessor—UTC day. In the paid-expedited incident mode, same-day topic/translation evidence is accepted only when `--confirm-paid-expedited-cutover` is present, only when it is source-bound to the same inactive target and service baseline, and only when both attestations were created before the predecessor claim. Every operation must bind the same clean pushed source and inactive target while the recorded service baseline remains alone at `100%`. Preserve the owner-only `topic-reconciliation-attestation.json` and staged-release-bound `translation-reconciliation-attestation.json` files. The staged evidence explicitly forbids pre-activation translation mutation and requires the exact candidate-active cleanup later in this runbook. Do not stage the candidate before canonical `finish`, hand-create evidence, or start without the complete immutable upload/prerequisite chain.

Run `start` after the immutable upload/prerequisite chain is ready. In the default Workers Free UTC-reset mode, this is allowed only during the final 30 minutes before a chosen UTC reset (`23:30:00.000Z` through `23:59:59.999Z`). In the paid-expedited incident mode authorized for this release, include `--confirm-paid-expedited-cutover`; the durable claim records `releaseTimingMode: "paid-expedited"` and may proceed without waiting for that reset window. Before it creates a new HMAC key, run directory, claim, predecessor reservation, or snapshot, it reserves a separate 17,304-read/zero-write live gate and proves exact `0013`-`0015` applied state, `0016` absent state, and same-day `0017` absent/deferred state. It nofollow-reads the immutable upload, deferred `0017`, topic, and translation evidence; requires the baseline alone at `100%` and the inactive target absent from deployment topology; proves every binding and timestamp; and embeds their hashes and aggregate results in the claim. Missing, replaced, wrong-day, partial, wrong-source, wrong-Worker, staged-candidate, changed-baseline, or changed-upload evidence fails before the predecessor. Only then does it create the fresh HMAC key, reserve and capture the bounded pre-`0016` predecessor, and stop at durable `predecessor-complete`. Record the returned non-secret run UUID. Do not use the generic migration wrapper for `0016`: its final write boundary deliberately refuses it.

```bash
pnpm cf:cutover:historical-data-fresh-0016 -- \
  start \
  --confirm-production \
  --confirm-lost-key-fresh-boundary \
  --confirm-paid-expedited-cutover
```

Run `finish` with that exact run UUID. In default Workers Free UTC-reset mode this must still be the following UTC day during its first 30 minutes (`00:00:00.000Z` through `00:30:00.000Z`). In paid-expedited incident mode, include the same `--confirm-paid-expedited-cutover` flag; the predecessor and successor may share a UTC day or use the exact next UTC day, and the existing maximum predecessor-to-successor evidence gap still applies. The coordinator acquires the production exclusion, admits the cumulative D1 release ledger, applies the exact source-pinned `0016` bytes plus the insert-only run marker, performs exact read-only runtime verification, captures the post-migration successor with the same fresh HMAC key while the outbox is empty, verifies nondecreasing protected data, publishes the canonical 12-stage completion artifact, and only then releases the exclusion:

```bash
pnpm cf:cutover:historical-data-fresh-0016 -- \
  finish \
  --run-id <exact-run-uuid> \
  --confirm-production \
  --confirm-lost-key-fresh-boundary \
  --confirm-paid-expedited-cutover
```

Still inside that same Day-2 parent, produce the standard read-only `0013`-`0016` report, then refresh only the replaceable deferred `0017` verifier report, and immediately run final deploy preflight. The `0017` refresh is bounded at 768 billed reads accounted beneath the still-maximum Day-2 parent; it has no separate top-level reservation and must remain read-only. Preflight has no legacy-baseline or expired-rollover fallback: it rebuilds and verifies the full append-only cutover chain, requires the existing canonical completion artifact, exact accepted policy, current pushed source and backup path, empty pre-activation outbox, and evidence no more than one hour old. The baseline must still be alone at `100%` and the target absent from deployment topology throughout `finish` and this preflight. Only after all three succeed may the already-uploaded target be staged at `0%`, override-smoked, sealed, and activated.

```bash
pnpm cf:verify:d1-runtime-migrations -- --confirm-production
pnpm cf:verify:d1-runtime-migration-0017 -- \
  --confirm-production \
  --expect-absent-deferred-free-plan
pnpm cf:preflight:deploy
```

Inspect a retained run without mutation authority or production confirmation flags:

```bash
pnpm cf:cutover:historical-data-fresh-0016 -- \
  status \
  --run-id <exact-run-uuid>
```

For an interrupted operation, preserve every state file and reuse only the exact run UUID. Re-run `start --run-id <exact-run-uuid>` or `finish --run-id <exact-run-uuid>` only with the same timing mode recorded in the durable claim; paid-expedited claims require `--confirm-paid-expedited-cutover` again, while default UTC-reset claims retain their pre-reset/post-reset windows. If status says D1 may have started, automatic retry is false, an authorization tail is unresolved, the owner process may still be live, or the chain is conflicting/broken, stop for reviewed readback recovery. Never delete, rename, replace, chmod, hard-link, symlink, or hand-edit the owner-only mode-`0700` run directory, its mode-`0600` evidence, the Keychain item, the live ledger, or the canonical completion artifact.

Immediately after activation and before any later validation mutation, verify preservation against the exact fresh successor rather than the unavailable legacy baseline. Topic and translation mutation are not remaining writes: their claim-bound reconciliation already completed before the predecessor and must not be repeated from the predecessor claim through this verifier. This must finish on the successor's UTC ledger day and within the 12-hour evidence window; the command full-chain-validates the canonical cutover, exact successor file hash, deferred `0017` absence proof, current source, HMAC identity, live still-maximum Day-2 parent, and a new authoritative candidate-active topology observation. That observation must bind the same upload/activation chain and show the target candidate alone at `100%`; the former service baseline must no longer serve. Only then does it compare the protected production data. Final preservation is the only step that may authorize exact parent refinement; do not refine after `finish`, the read-only verifiers, preflight, staging, or activation. There is no fallback to the expired rollover:

```bash
pnpm cf:verify:historical-data-fresh-0016-preservation -- \
  --confirm-production \
  --fresh-0016-run-id <exact-run-uuid>
```

The resulting fresh boundary is a one-release incident policy, not a reusable shortcut. After this release is accepted, future steady-state releases must capture a normal current V2 baseline with a newly authorized release key before their first mutation.

The final verifier is a two-phase Day-2 child. It writes an owner-only last-pre-D1 authorization immediately before its snapshot command and an owner-only prepared capture after successful bounded readback but before exact ledger refinement. A crash with authorization but no prepared capture is ambiguous and must retain the aggregate maximum without a second D1 snapshot. A durable prepared capture finalizes exact accounting and the report without querying D1 again; a durable final report replays only aggregate refinement. Any missing, linked, broadly readable, cross-day, source/Worker/parent-budget, HMAC, deferred-`0017`, activation-topology, or capture-hash ambiguity keeps the maximum. The Day-2 order is fixed: `finish`/fresh `0016`, standard read-only runtime verification, read-only deferred-`0017` refresh, baseline-only preflight, candidate staging, override smoke, pre-activation seal, activation, candidate-active final preservation and exact parent refinement, candidate-active Vectorize readiness, exact candidate-active staged translation cleanup, then authenticated validation.

## Additive D1 runtime migrations 0013-0017

Migrations `0013`, `0014`, and `0015` are the already-applied prerequisite prefix for the accepted fresh boundary. `0013` adds bounded indexes on `rate_limit_windows(reset_at)`, `ai_runs(created_at)`, and `ops_events(user_id)`. `0014` stores the durable all-time native admin totals snapshot. `0015` adds the two nullable activity completion receipts and their unique partial indexes. If exact read-only state does not show this complete prefix with `0016` absent, stop; do not try to repair the state inside the cutover window.

Migration `0016` belongs exclusively to the fresh-boundary coordinator above. It adds the checked `user_memory_settings.summary_suppression_mask`, creates the initially empty `memory_vector_cleanup_outbox` and its exact due index, performs the bounded compatibility backfill, writes the fixed `runtime-migration-0016-complete` marker, and inserts the source/run-bound fresh-cutover marker in the same transaction. The generic migration child has a final write-boundary guard that refuses raw `0016`, even when called through the production release wrapper. Do not weaken that guard and do not invoke any migration SQL through ad-hoc Wrangler commands.

The coordinator performs its own account-wide D1 admission, cumulative ledger reservations, bounded cardinality projection, immutable pre-write evidence, exact migration rendering, Time Travel diagnostic capture, ambiguity classification, and read-only state verification while it owns the production exclusion. It rejects truncated analytics, cap hits, UTC-day drift, source drift, partial state, excessive projected reads or writes, and an outbox that is not empty before activation. In paid-expedited mode the explicit paid timing flag is the only shortcut around the old Free-plan reset wait; do not lower the reservation, bypass the ledger, or run a separate migration wrapper.

`pnpm cf:upload` intentionally occurs before canonical cutover and requires only the fresh upload-time preparation plus baseline-only topology; it does not consume post-cutover migration reports. After canonical cutover completion, `pnpm cf:verify:d1-runtime-migrations -- --confirm-production` proves all `0013`-`0016` checks in one read-only attempt and writes the fresh source-bound mode-`0600` report required by deploy preflight. Immediately after it, `pnpm cf:verify:d1-runtime-migration-0017 -- --confirm-production --expect-absent-deferred-free-plan` replaces only `cloudflare/d1-runtime-migration-0017-report.json` with the Day-2 source-bound absence/deferred proof. Baseline preflight, staging, pre-activation sealing, and activation require both fresh reports, the independently full-chain-validated canonical fresh boundary, canonical upload evidence, and the exact upload-bound preparation provenance. Any later tracked-source change invalidates all release gates. None of these commands uses `d1 export`.

Migration `0017` remains tracked as a deferred maintenance migration. Its SQL creates the additive covering expression index `users_normalized_email_lookup_idx` on `lower(email), id, email`, but this release does not apply it because production currently exceeds the guarded Free-plan index-build write envelope. Runtime Google linking now uses the existing unique `users(email)` index first and only performs the bounded `lower(email)` ambiguity scan when exact lookup misses. This keeps normal auth on an indexed path without mutating the 40k-user production table during the Free-plan release. Do not append `0017` to `0016`, rerender the accepted cutover, or invoke its SQL directly.

The guarded `pnpm cf:apply:d1-runtime-migration-0017 -- --confirm-production` tooling remains available for a future reviewed maintenance window, but it is not part of this release path. It still performs its own production-exclusion, ledger, source, storage, cardinality, guarded-SQL, write-attempt, and exact-verification checks and must fail closed if production exceeds its admission envelope. For this release, only the read-only verifier is accepted, and preflight requires state `absent` with policy state `absent-deferred-free-plan`.

Final deploy preflight requires all three independent proof classes: the fresh unchanged `0013`-`0016` verifier, the full canonical `0016` cutover chain (which binds the deferred `0017` absence proof), and the fresh source-bound mode-`0600` refreshable `0017` verifier report. A tracked-source change invalidates all of them.

The production migrations, standalone source sync, topic sync, Worker deploy, translation maintenance, authenticated validation, and main-Worker rollback all use the same D1-backed production exclusion. The four D1 child scripts refuse direct remote execution unless their parent wrapper proves the exact live owner. The parent revalidates the sole active Worker and repository fingerprint after acquisition, renews the lease while the child runs, holds it through the child report and authoritative readbacks, and releases only after final certification. A crashed non-validation operation leaves a bounded lease; after D1 declares it expired, the next guarded operation replaces it atomically. Do not invoke the underlying TypeScript files or raw Wrangler mutation commands directly.

All five migrations are additive. A Worker rollback leaves their table, columns, indexes, and snapshot in place; do not drop them during an application rollback.

## Translation gate

The repository owns the curated translation bundles used at build time. This
release uses the distinct **staged canonical-English-fallback** contract: keep
every complete, source-current tracked curated pack, promote no new site
translation cohort, and omit every incomplete or stale locale/route from localized Static
Assets, navigation, and sitemap output. An omitted localized route resolves
through the canonical English experience. Partial packs and mixed-language
localized documents remain forbidden.

The future full multilingual completion definition is unchanged: 124 site
namespaces across 69 non-English targets equals 8,556 site packs; the 69
compact main-app packs bring the full semantic corpus to 8,625 packs; and the
separate 69-row legacy `marketing-site` aggregate brings the eventual exact D1
inventory to 8,694 rows. That full-corpus generation, audit, legacy-delta, and
D1-repair workflow is deferred and is **not executable for this release**. Its
status, restart requirements, and unchanged completion criteria live in
`docs/language-translation-work.md`.

All 69 compact main-app packs remain mandatory. Full main-app editing packs are
ignored workbench files and must never affect release identity. The deliberately
filtered legacy Static Assets API remains fixed at 280 compatibility assets and
is not the D1 corpus.

```bash
env NO_UPDATE_NOTIFIER=1 PNPM_DISABLE_SELF_UPDATE_CHECK=true \
  npm_config_offline=true \
  pnpm --config.offline=true --config.update-notifier=false \
  translations:static-main-app:check
env NO_UPDATE_NOTIFIER=1 PNPM_DISABLE_SELF_UPDATE_CHECK=true \
  npm_config_offline=true \
  pnpm --config.offline=true --config.update-notifier=false \
  translations:verify-site-source-manifest
```

### Current no-new-site-promotion fallback branch

Translation generation and site-pack promotion are closed for this release.
The incomplete R16 and R17 Afrikaans candidate roots remain ignored,
untrusted, and non-promotable; they are not attestation, D1, build, deploy, or
source-fingerprint inputs. The exact tracked inventory is 691 physical site
packs: 599 complete/source-current clean packs plus 92 stale packs. The pending
ledger is 7,957 entries (7,865 missing and 92 stale), the availability manifest
advertises exactly 245 localized HTML paths, and all 69 compact main-app packs
remain mandatory. Every pending site translation uses canonical English
fallback.

Create the distinct selected attestation from those tracked bytes:

```bash
pnpm translations:attest-current-fallback
```

The command requires its fixed `--current-no-site-promotion` package argument
and creates then nofollow-rereads
`translations/current-fallback-no-site-promotion-attestation.json`. It binds
the exact source and availability manifests, 245-path set, curated and
main-app trees, 7,957-entry pending ledger, explicit no-promotion scope, and
canonical English fallback policy. It grants no deployment, production-read,
production-write, full-semantic, full-D1-repair, production-sync, legacy-delta,
or promotion authority by itself.

### Future finalized-Afrikaans branch (not selected for this release)

The independently gated finalized-Afrikaans attestation schema, semantic
promotion proof reader, and corpus loader remain in code for a future
translation run. They are not operative deploy-preflight or pre-activation
seal inputs for this release. R16 and R17 failed closed and must never be
resumed, audited, promoted, or represented as finalized evidence. A future
attempt must use a fresh run root and pass its complete generation, semantic
audit, transactional promotion, regenerated availability, and attestation
gates before that branch can be selected in a separately reviewed runbook.

### Staged D1 reconciliation contract and rollback-safe cutover

The staged path is separate from the deferred full-corpus repair. It rebuilds
the exact allowed D1 corpus from nofollow-validated current bytes: 599 clean
site pairs plus all 69 main-app pairs, for 668 exact rows. The selected path
asserts those availability-derived tracked counts; it never
substitutes the numbers for the canonical row inventory. Every other
`app_translations` pair—including source-stale/missing targets, unsupported
identities, retired game data, and the obsolete 69-row `marketing-site`
aggregate—is outside the final set. Current source catalog rows and strings are
upserted additively and are never deleted by this staged cleanup.

First create the owner-only local plan authorization after the tracked staged
fallback attestation exists:

```bash
pnpm cf:d1:reconcile-staged-translations -- \
  --release-mode staged-canonical-English-fallback \
  --prepare-local-authorization
```

The command emits the exact plan/resume paths. The authorization grants only
local candidate-input validity. Its production-read, production-write,
deployment, and deploy-by-itself flags are all false. It binds the attestation
file/self hashes, source/availability/localized-path manifests, both trees,
target and pending sets, fallback policy, explicit no-site-promotion scope,
exact 668-row identity root, payload corpus root, and SQL hash.
A changed, linked, nonregular, replaced, traversal-escaped, duplicated, stale,
or mixed-mode input invalidates it.

Do **not** delete legacy D1 rows while the old service baseline is serving. The
predecessor-day reconciliation is deliberately read-only: it exact-reads the
current state, byte-checks every already-present desired row, reports whether
post-activation cleanup is required, and writes an owner-only prepared
readback before exact ledger refinement. A retry consumes that same
candidate/source/plan-bound readback without querying D1 again; it cannot
substitute different billing or row evidence. Every D1 result set must report
exactly one attempt; missing or retried billing metadata keeps the maximum and
fails the seal. A durable last-pre-read attempt without its matching prepared
readback forbids an automatic same-day reread. The command then writes the
distinct staged plan-ready reconciliation evidence. Extras remain visible in the report and
are not misreported as an exact 668-row database. This avoids an unproven
interval in which an older rollback baseline could still request its aggregate
translations.

```bash
pnpm cf:d1:reconcile-staged-translations -- \
  --release-mode staged-canonical-English-fallback \
  --remote --verify-only --confirm-production \
  --phase uploaded-inactive \
  --candidate-version <exact-uploaded-inactive-candidate-uuid> \
  --local-authorization <exact-owner-only-local-authorization-path>
```

Only the later guarded candidate-active cleanup may mutate translations. It
requires the exact upload/activation chain, staged reconciliation, local plan,
fresh canonical final-preservation proof, fresh candidate-active Vectorize
evidence, clean pushed source, current
artifacts, the candidate alone at `100%`, the cumulative D1 ledger, storage and
statement admission, production exclusion, native write-freeze maintenance,
diagnostic Time Travel bookmark, and an attested single SQL file. It resets
every desired payload to `{}` before bounded patches, deletes the symmetric
difference, byte-rereads all 668 rows, verifies every required current source
catalog row and source string without deleting preserved extras, restores the
same active candidate, and writes a fresh owner-only cleanup attestation whose
exact pre-write, budget, maintenance, resolution, and atomic-SQL chain is
consumed by authenticated
production validation.

Immediately before its first D1 read, cleanup writes a candidate/plan/source/
authorization/budget-bound owner-only attempt marker. That marker is included
by hash in the cleanup attestation. A reused maximum reservation or an earlier
same-day marker without final cleanup evidence forbids automatic retry; retain
the reservation and review the recorded maintenance/pre-write state instead.

```bash
pnpm cf:d1:reconcile-staged-translations -- \
  --release-mode staged-canonical-English-fallback \
  --apply-cleanup --remote --confirm-production \
  --confirm-native-write-freeze --phase candidate-active \
  --candidate-version <exact-active-candidate-uuid> \
  --local-authorization <exact-owner-only-local-authorization-path>
```

The cleanup is after candidate activation and fresh candidate-active Vectorize
readiness, but before authenticated production validation. If import may have
started and exact reread does not pass, the native maintenance version remains
active and the unresolved marker remains for reviewed forward correction. An
older production repair marker continues to block every path. Resolve only the
exact recorded run after reviewed correction (or proof that no D1 write
occurred):

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

For this one-release accepted fresh-boundary `0016` cutover, the standalone source synchronizer is
explicitly forbidden. Do not invoke the `cf:sync:site-translation-sources` package script during
this release. The guarded production wrapper mechanically rejects that operation before reading
source state, the active Worker, or acquiring the D1 exclusion; the package entry is intentionally
non-executable for this cutover. Any future staged-scope source reconciliation
must be part of the candidate-bound atomic translation delta described above;
running the standalone path would spend from the same cumulative UTC-day ledger
without the required candidate/deploy continuity. The standalone tool remains
available only for a future, separately reviewed steady-state runbook after
this one-release restriction is removed.

Never commit the generated SQL, backups, or reports.

## Local gates

Run the repository gates before every deployable change:

```bash
env NO_UPDATE_NOTIFIER=1 PNPM_DISABLE_SELF_UPDATE_CHECK=true \
  npm_config_offline=true \
  pnpm --config.offline=true --config.update-notifier=false \
  translations:verify-site-source-manifest
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm cf:build
pnpm cf:check:resource-budget
pnpm cf:scan:source-secrets
pnpm cf:scan:build-artifacts
pnpm cf:check:www-redirect
E2E_TEST_AUTH_SECRET="$(openssl rand -hex 32)" \
E2E_TEST_AUTH_EMAIL="codex-e2e@inspirlearning.invalid" \
REQUIRE_LIVE_AI=1 \
pnpm cf:test:e2e:preview
pnpm cf:verify:local
```

After the staged local D1 plan/contract tests and all of these gates pass,
commit and push the exact release source, then keep it unchanged.
Confirm the worktree is clean, the branch has an upstream, and local `HEAD`
equals that upstream. Seal the already-built local release and immediately
upload the exact candidate without traffic before the deferred `0017`
verification, Vectorize, topic, and translation prerequisites:

```bash
pnpm cf:prepare:deploy
pnpm cf:upload
```

The owner-only, append-only preparation is purely local: it does not read or mutate production. It binds the pushed Git identity, exact source fingerprint, native Worker and Wrangler configuration hashes, the complete symlink-free Static Assets manifest, resource inspection, complete translation/materialization proof, and byte hashes of the live-preview E2E, local-gate, source-secret, and build-artifact reports. Those reports must be no more than one hour old when sealed. The preparation remains eligible to authorize an upload for at most 12 hours and only while every bound byte and identity is unchanged. `cf:upload` consumes that exact preparation, creates an inactive Worker version, proves the recorded service baseline remains the sole version at `100%`, and publishes immutable upload evidence without routing traffic to the candidate. The upload timestamp must fall inside the preparation's original interval, including its exact end boundary. Later stage/seal/activation operations nofollow-read and hash-check those exact preparation bytes through canonical upload evidence; expiration after a valid upload does not authorize replacing or refreshing them. A missing, expired-before-upload, replaced, linked, broadly readable, hash-mismatched, or upload-unbound preparation has no build, recertification, or upload fallback.

With the prerequisite evidence complete and source-bound, execute the fresh-`0016` predecessor/successor cutover exactly as ordered in this runbook. After Day-2 `finish`, produce the standard read-only `0013`-`0016` report, refresh the separate read-only deferred `0017` report, and immediately run `pnpm cf:preflight:deploy`. Preflight intentionally refuses a dirty, unpushed, or diverged tree; do not bypass it to obtain an early deploy report. The upload-bound preparation provenance does not extend the canonical fresh-`0016` completion or either read-only runtime-migration report: all three still must be no more than one hour old at activation.

`pnpm cf:build` performs a clean sanitized OpenNext build and then materializes the prerender cache into `.open-next/assets`. Inspect `.open-next/static-marketing-assets-report.json` and require:

- at least 100 public HTML documents and the exact availability-derived
  localized HTML path set (245 for the selected no-promotion release), with no
  localized route outside that manifest;
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

`pnpm cf:preflight:deploy` rejects dirty or unpushed Git state, a generated site-source manifest whose ordered namespace set, field keys, source bytes, per-namespace hashes, counts, or full-corpus roots differ from current extraction, missing or mismatched canonical upload/preparation provenance, stale source-fingerprinted gate evidence outside that exact provenance, missing/stale/wrong-source live-preview evidence, any preview report without `REQUIRE_LIVE_AI=1` and authenticated local coverage, any skipped test beyond the exact two production-only cases, a mismatched materialization report or actual asset tree, missing or incorrect D1/Vectorize/profile-R2/Queue/cron bindings, any OpenNext incremental-cache R2 binding, an extra Worker-first route, paid CPU configuration, missing Static Asset 404 boundary, missing translation/chat/admin artifacts, missing rollback-safe Durable Object infrastructure, or a main Worker that imports OpenNext. The freshness report records both the complete manifest and non-aggregate routed namespace/field counts and roots from current data rather than relying on sampled routes or a hard-coded corpus size. The deploy wrapper never rebuilds or rematerializes production activation. It revalidates the exact upload-bound preparation, resource contract, read-only artifact scan, Static Assets tree, full preflight, production exclusion, and Worker/config/asset hashes immediately before Wrangler runs.

For local browser coverage:

```bash
pnpm cf:d1:local:setup
E2E_TEST_AUTH_SECRET="$(openssl rand -hex 32)" \
E2E_TEST_AUTH_EMAIL="codex-e2e@inspirlearning.invalid" \
REQUIRE_LIVE_AI=1 \
pnpm cf:test:e2e:preview
```

The preview runner starts a sanitized Wrangler preview itself and refuses to start release coverage unless `REQUIRE_LIVE_AI=1` and both valid E2E values are supplied. The local-only config treats that exact email as an admin. The evidence gate requires account/saved-chat/memory/admin preservation, authenticated tutor memory and cross-chat recall, complete quiz results, complete flashcard results, and a real streamed guest response all to pass exactly once. Its skipped-title set must be exactly the two production-only tests (Worker version pinning and read-only production-account preservation); every other skip fails the release. Run this before `pnpm cf:verify:local`, which independently validates the current source-bound owner-only report and records `cloudflare-preview-live-e2e` in the local-gate evidence. `E2E_TEST_AUTH_IS_ADMIN` is retired and has no effect.

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

## Uploaded-inactive and candidate-active Vectorize readiness gates

Before the earlier-day topic or translation path can touch D1, capture a fresh read-only
Vectorize attestation against the exact uploaded-inactive candidate while its service baseline
remains the sole version at `100%`:

```bash
pnpm cf:verify:vectorize-readiness -- \
  --remote \
  --confirm-production \
  --phase uploaded-inactive \
  --candidate-version <exact-uploaded-inactive-candidate-uuid>
```

This command is strictly read-only and records all five remote reads in order: `wrangler
deployments status` before the Vectorize inspection, `wrangler vectorize get`, `wrangler vectorize
info`, `wrangler vectorize list-metadata-index`, and a second `wrangler deployments status`
readback. It never creates an index, creates a metadata index, inserts a vector, or changes
Cloudflare state. It fails unless the clean local `HEAD` equals its pushed upstream, the private
upload evidence and immutable source/Worker/config/asset evidence bind the exact candidate, both
deployment readbacks keep the recorded service baseline alone at `100%` and the candidate
inactive, `MEMORY_VECTORIZE` binds the exact
`inspirlearning-memory-prod` index, the immutable remote configuration is exactly 512 dimensions
with cosine distance, the index contains at least one vector, and the remote metadata indexes are
exactly `userId:string` and `chatId:string`, matching Wrangler's lowercase API contract. Success durably writes fresh, source- and
candidate-bound owner-only mode-`0600` evidence under the active backup directory.
Topic sync requires this exact `uploaded-inactive` evidence before its first D1
operation. The staged translation reconciliation must require the same evidence
before its first read-only D1 query. It expires after 30 minutes; rerun the same
read-only inactive-phase command against the unchanged upload when needed
before staging.

After atomic activation and the immediate candidate-active fresh-`0016` preservation verifier,
repeat the same read-only inspection for the activated topology:

```bash
pnpm cf:verify:vectorize-readiness -- \
  --remote \
  --confirm-production \
  --phase candidate-active \
  --candidate-version <exact-active-candidate-uuid>
```

The active-phase report additionally requires the complete upload, staged, and activation evidence
chain and the candidate alone at `100%`. Authenticated production validation consumes only this
fresh `candidate-active` readiness. It cannot authorize topic synchronization
or staged translation reconciliation; both remain uploaded-inactive-only.

## Atomic managed-topic reconciliation

For the accepted fresh-`0016` incident path, execute this section on a strictly earlier UTC day before `start`; its successful attestation is a predecessor prerequisite. Do not execute it after the fresh claim. Other future steady-state releases retain their ordinary ordering.

Immediately after the Vectorize gate, retire the removed arena and reconcile the tracked topic
catalogue with one guarded transaction:

```bash
pnpm cf:sync:topic-seeds -- \
  --remote \
  --confirm-production \
  --candidate-version <exact-uploaded-inactive-candidate-uuid>
```

This order is a Free-plan safety invariant. Topic sync first reserves its conservative maximum of
2,500,000 reads and 50,000 writes, then refines that reservation to its exact snapshot-derived cost
before import. The staged read-only plan seal then reserves its own conservative
read maximum and refines it to exact billed reads with zero writes. The later
candidate-active cleanup separately retains the 2,500,000-read/50,000-write
maximum until exact post-import proof. Both operations use the cumulative
ledger, so the combined projection must remain inside those lag-safe ceilings.
Do not borrow the deferred full-corpus repair's assumptions, reverse these
sections, or split them across untracked commands.

The command requires `--candidate-version <exact-uploaded-inactive-candidate-uuid>`. Its parent validates the same clean pushed Git/source/Worker/config/assets/upload/readiness identity and proves the recorded service baseline remains alone at `100%` before acquiring the production D1 exclusion; the child repeats that gate before its first D1 query and immediately before import. It checks the cumulative UTC-day D1 release ledger before its first D1 SQL, records a diagnostic Time Travel bookmark and explicit forward-correction-only policy, executes one atomic SQL file, and exact-verifies every managed, retired, and untouched topic plus both seed metadata rows. Only after that verification succeeds does it durably write the owner-only topic-reconciliation attestation consumed by translation work. It serializes no destructive restore recipe. A lost Wrangler response succeeds only after exact verification; a definite mismatch or indeterminate read requires a reviewed forward correction. It archives only `ai-game-arena` and stale slugs from the previous repository-owned `topic_seed_slugs` manifest; it never changes an existing topic ID or created timestamp and its SQL never reads or writes account, user, chat, message, session, or memory rows. If this command fails, the release is incomplete: leave the service baseline serving, do not stage the candidate, and use a reviewed forward correction for D1.

## Predecessor-day translation reconciliation for the inactive candidate

This remains a mandatory predecessor prerequisite after topic reconciliation
and before fresh-`0016 start`, while the exact uploaded candidate is inactive
and the service baseline remains alone at `100%`. Run the uploaded-inactive
read-only command in the staged D1 section above. It validates fresh Vectorize
and topic evidence, the exact local non-authority plan, current tracked staged
evidence, clean pushed source and immutable upload; every Wrangler D1 statement
is checked as read-only. It publishes
`production-staged-translation-reconciliation-v1`, whose pending-to-success
transition consumes the exact same release mode, candidate, topic, corpus, and
plan. The success embeds the read-only cutover policy:

```bash
pnpm cf:d1:reconcile-staged-translations -- \
  --release-mode staged-canonical-English-fallback \
  --remote --verify-only --confirm-production \
  --phase uploaded-inactive \
  --candidate-version <exact-uploaded-inactive-candidate-uuid> \
  --local-authorization <exact-owner-only-local-authorization-path>
```

Phase 1 is exactly uploaded-inactive read-only derive/hash/verify/seal with zero
translation writes. Phase 2 occurs only after the candidate is sole-active: a
single atomic transaction resets and UPSERTs all 668 desired rows and deletes
all nonmembers, followed by exact byte readback before maintenance ends. There
is no preactivation translation UPSERT.

- pre-activation D1 translation mutation is false;
- legacy rows remain untouched while the prior baseline serves;
- candidate-active exact cleanup is mandatory; and
- the desired result remains the independently derived 599 + 69 = 668 rows.

Fresh-`0016` accepts a strict full-or-staged evidence union. It rejects unknown,
legacy-as-staged, extra-field, mixed-mode, changed-corpus, changed-proof, or
post-attestation tree evidence and carries the staged policy and exact roots
into its immutable prerequisite chain. Do not substitute the full-corpus
command, hand-create reconciliation evidence, or reuse another candidate's
plan. Any indeterminate read leaves the service baseline serving and the
release blocked. Pre-activation translation mutation remains forbidden; the
only mutation is the guarded candidate-active cleanup described above. Never
edit a budget ledger or production attestation by hand.

## Guarded candidate stage and atomic activation

Record the active versions before changing production:

```bash
pnpm exec wrangler deployments status --name inspirlearning --json
pnpm exec wrangler deployments status --name inspirlearning-www-redirect --json
curl -fsS https://inspirlearning.com/api/health
```

The main rollback target must be at or after `opennext-cache-queue-v1`; Cloudflare cannot roll a migrated Worker back to a pre-migration version.

Only after canonical fresh-`0016` completion, both fresh runtime-migration reports, and baseline-only deploy preflight pass may the already-uploaded target be staged. `cf:stage-candidate` creates the exact baseline-`100%`/candidate-`0%` deployment. Prove that staged candidate through Cloudflare's version override before creating the activation seal:

```bash
pnpm cf:stage-candidate
pnpm cf:verify:candidate-override -- --confirm-production
pnpm exec tsx scripts/cloudflare/worker-candidate-pre-activation-seal.ts
pnpm cf:deploy
pnpm exec wrangler deployments status --name inspirlearning --json
```

`cf:verify:candidate-override` issues one cache-bypassed, unpinned `GET /api/health` that must identify the exact `100%` service baseline, then sends the documented `Cloudflare-Workers-Version-Overrides: inspirlearning="<candidate UUID>"` header to the same endpoint. Only an exact candidate-attributed JSON response with `X-Inspir-Delivery: lean-api-worker`, private/no-store policy, accounts/saved-state/memory/admin enabled, OpenNext and games disabled, and the expected version metadata can pass. A valid baseline response to a pinned request is retried only within the bounded global-propagation window; a wrong UUID, transport failure, cacheable response, or wrong architecture fails immediately. The command re-reads the immutable upload and staged topology and requires activation evidence to remain absent before publishing the owner-only, nofollow, exclusive `cloudflare/worker-candidate-version-override-smoke.json` report.

The 20-minute pre-activation seal can be created only while that exact smoke is newly fresh. Seal creation and every activation reread bind its file hash, baseline and candidate UUIDs, upload and staged hashes, staged deployment/topology identity, response hashes, and timestamps. `pnpm cf:deploy` requires that exact seal, canonical fresh-`0016` cutover chain, and both fresh read-only reports, including the deferred `0017` absence report; it reruns preflight, performs no build or evidence regeneration, revalidates the immutable release bytes again under the production exclusion, and activates the exact staged candidate without uploading fresh code. Do not edit `.open-next`, regenerate reports, rebuild after cutover, or bypass the wrapper. Any mismatch stops before activation. The canonical fresh-`0016` completion and both read-only reports remain a hard one-hour activation window; if any expires, the seal cannot recertify it. Keep the Day-2 parent reservation at its maximum through activation and the required candidate-active fresh-`0016` preservation verifier; only that verifier may authorize exact parent refinement. The native Worker and Static Assets manifest are one versioned deployment.

## Production verification

Before any mutation or Cloudflare API-token use, the authenticated verifier sends a bounded public `GET /api/health` with a non-secret readiness nonce, the exact expected-version override, and the same random header used by the HTTP-tail filter. Both JSON Tail streams must independently capture that exact clean `200` invocation on the expected Worker version, and the health body must report the same version; Wrangler's pretty-only connection diagnostic is not readiness evidence.

Use the single candidate-version UUID reported at 100%. Authenticated production verification is mandatory and uses five temporary Worker secrets. The wrapper generates `E2E_TEST_MUTATION_RUN_ID` and a hard `E2E_TEST_AUTH_EXPIRES_AT`, manages `E2E_TEST_AUTH_REQUIRE_EXISTING=1`, and installs the operator-supplied `E2E_TEST_AUTH_EMAIL` and `E2E_TEST_AUTH_SECRET`. `E2E_TEST_AUTH_EMAIL` must be the exact lowercase email of an existing configured admin. The historical-account action fails with `409` if that user is absent, reuses the existing ID without updating any user/profile field, confirms `isAdmin` from server configuration, and never creates a user or admin grant. A separate candidate/run-bound action creates only a deterministic non-admin `@inspirlearning.invalid` disposable user for mutation validation. An exact-session, live-capability action may then grant only that marked disposable identity temporary database-admin status so the real admin mutation APIs can be tested; it cannot elevate the historical account or an arbitrary email. Keep `ADMIN_EMAILS` unchanged.

Run the guarded wrapper below instead of installing or deleting temporary secrets by hand. Before its first secret write, it proves all five temporary names are absent; validates fresh candidate-active Vectorize readiness; pure-locally validates the fresh canonical final-preservation proof; revalidates the unchanged successful earlier-day translation attestation bound into the canonical fresh-`0016` chain; requires the exact successful candidate-active staged cleanup bound to that attestation; proves the candidate's clean pushed source/private deploy evidence and sole `100%` deployment; and writes a private, fsynced recovery manifest under the active backup directory. If Vectorize readiness expires, rerun only the read-only `--phase candidate-active` Vectorize command. Never rerun the uploaded-inactive translation plan seal after `start`, and never run any translation mutation after the exact candidate-active staged cleanup succeeds. The manifest binds the candidate, pushed source fingerprint, immutable Worker resources, baseline secret names, mutation run, 90-minute capability expiry, historical-session purposes, installed-secret progress, cleanup proofs, and the cumulative D1 lock budget. Each secret operation must produce only an exact secret-triggered version of the same immutable release. The wrapper installs the route capability last, samples the first real requests under tail, runs the outcome/smoke/private read-only Playwright and disposable mutation gates, then exact-cleans and independently verifies both historical validation sessions and the disposable graph before removing the route capability first and all remaining temporary secrets. Immediately before the one explicit real post-turn Queue publish, the mutation gate also writes owner-only recovery evidence containing the deterministic revision-bound `t:<user-message-uuid>:<16-hex-revision>` Vectorize ID and its candidate/run/source/chat bindings; a publish cannot precede this durable evidence.

Authenticated-validation recovery additionally pins the exact translation
attestation hash and, for staged releases, the cleanup run plus cleanup,
pre-write, and resolved-evidence hashes. Recovery therefore cannot swap staged
and full reconciliation or substitute another otherwise-valid cleanup chain.

The private manifest is only the machine-local recovery record. Cross-workspace exclusion comes from one atomic compare-and-swap row at `app_metadata.native-production-validation-lock-v1`, acquired before any temporary secret mutation. Its exact non-secret owner contains only the candidate UUID, mutation-run UUID, source fingerprint, lease-generation UUID, and bounded lease expiry. D1's clock—not an operator workstation's clock—decides whether ownership is live or expired. A live foreign owner, noncanonical or malformed row, unexpected field, source mismatch, stale lease generation, or lost ownership fails closed. Renewal requires the exact prior canonical owner and a fresh lease generation. Recovery never steals a copied live generation; it waits for D1 expiry and then copied recovery processes race through one expired-owner compare-and-swap. The wrapper durably reserves each lock operation before invoking D1, enforces cumulative maxima of 128 operations, 1,024 rows read, and 64 rows written (including indexed primary-key writes), and records returned D1 billing metadata. It attests or renews ownership before and after every secret operation and authenticated child gate even when the operation itself fails, and holds the lock through the final secret-free outcome/production/hidden-route gates. Every ordinary production deploy, migration, sync, rollback, translation-repair, and authenticated-validation wrapper refuses a live owner or durable maintenance marker; only the exact confirmed recovery paths may reclaim expired ownership or resolve the recorded maintenance state. The lock is deleted with an owner-qualified statement and exact absent readback only after all validation residue is zero and all five temporary Worker secrets are authoritatively absent.

If validation or cleanup fails, the wrapper attempts to rotate the mint expiry to epoch `1` and retains the recovery manifest; do not delete that evidence. `SIGINT`, `SIGTERM`, `SIGKILL`, or machine loss cannot safely perform asynchronous network cleanup in a signal handler, so interruption deliberately leaves the capability bounded by its original expiry and requires the guarded `--recover` workflow below. After zero residue and authoritative absence of all five secrets, the wrapper discovers the final secret-free version, reruns the cold-first tail CPU/resource gate before the ordinary production verifier, proves the hidden route is `404`, and only then removes the manifest.

```bash
export E2E_TEST_AUTH_SECRET="$(openssl rand -hex 32)"
export E2E_TEST_AUTH_EMAIL="<exact-existing-configured-admin-email>"
REQUIRE_LIVE_AI=1 pnpm cf:verify:authenticated-production -- \
  --candidate-version <exact-activated-candidate-version-uuid> \
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

Recovery revalidates the current source fingerprint, deploy evidence, original candidate-bound Vectorize and translation release bindings, the immutable candidate-active staged cleanup and its owner-only pre-write proof, immutable active Worker resources, exact secret set, and stored D1 budget before changing remote state. It does not require the original candidate to be active while a temporary secret-derived version legitimately owns traffic, and it does not let readiness or cleanup-evidence age—or a missing normal-path acceptance proof—block emergency cleanup; the recovery manifest and active-version sequence separately bind every secret-derived version to that immutable candidate. If the exact memory-recovery sidecar exists, recovery requires its authenticated-version/run/source/chat binding and deletes only the one recorded deterministic disposable-test vector ID `t:<user-message-uuid>:<16-hex-revision>`—never a metadata-selected set, another user's vector, or the index. It proves that exact ID absent before hidden D1 cleanup, then repeats bounded exact-ID deletion/absence polling after D1 cleanup to fence a late in-flight Queue upsert. The sidecar is removed only after the post-D1 absence proof; if no sidecar exists, a crash before the authenticated-version manifest update safely falls back to the current secret-derived version and performs no Vectorize mutation. Recovery reacquires or renews only the manifest's same global lock identity, holds it through this known-ID cleanup and the complete disposable sweep, deletes secrets in the guarded order, proves the route is disabled, releases the lock with an absent readback, and retains both recovery records on any indeterminate result. A recovered release must still rerun the full authenticated production validation before acceptance.

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
