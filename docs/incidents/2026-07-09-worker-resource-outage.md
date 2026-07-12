# 2026-07-09 Cloudflare Worker resource outage

## Verdict

The incident was a request-time CPU and heap failure in the shared OpenNext Worker. It was not a Worker upload-size or startup-limit failure, and the game-arena code was an activator rather than the sole cause: CPU failures continued after the arena version was rolled back.

## Evidence

- The retained production tail recorded `Exceeded CPU Limit` for Hindi chat, Better Auth social sign-in, and Spanish prompts after rollback. The same window recorded `Dummy queue is not implemented` while stale pages attempted revalidation.
- The deployed Worker exported `DOQueueHandler` but had no `NEXT_CACHE_DO_QUEUE` binding.
- The previous translation readers retained D1-backed promises and large dictionaries in unbounded module-level maps. Production D1 contained 8,625 translation rows across 125 namespaces and 69 languages, with roughly 107 MB of raw payload before JavaScript expansion.
- The matching OpenNext cache contained 1,435 entries and 541 MB. Locale variants were about 92% of the cache because every one of 69 non-English locales generated every localized child route, even when no curated body translation existed.
- Topic reads performed seed synchronization in request paths. The rollback occurred at 20:24:58 UTC and `topic_seed_hash` changed at 20:25:19 UTC, directly correlating rollback traffic with 84 write attempts per cold isolate.
- Worker-wide caching returned a shared-cache `HIT` for the same `/api/auth/get-session` URL with and without a Better Auth cookie. The route had no fail-closed cache headers.
- The Worker bundle remained around 2.73 MB compressed and startup remained under 100 ms, below platform limits. Raising `limits.cpu_ms` before removing the leak and stampede would only have hidden those defects.
- After the architecture fixes were deployed, an exact-version 90-request production soak captured seven `503` responses: five localized pages and two game-result writes. The live tail attributed every failure to `exceededCpu` at 10–22 ms of reported CPU time.
- A deployment with source-controlled `limits.cpu_ms = 5000` was rejected before version creation with Cloudflare API code `100328`: the production account is on the Workers Free plan, which does not support configurable CPU limits. The remaining outage is therefore an account-plan/runtime mismatch, not residual unbounded translation or cache work.

That last finding described the intermediate OpenNext design, not the final resolution. The product decision was to stay on Workers Free and remove the shared request-time OpenNext runtime instead of paying for a larger CPU allowance.

## Remediation

1. Serve public and localized documents directly from Workers Static Assets. Next and OpenNext remain build tools only and are not imported by the deployed request handler.
2. Replace request-time Next routes with a framework-neutral Worker that owns only exact account, saved-chat, memory, admin, activity, analytics, health, and tutor API paths.
3. Force every private response to private/no-store at browser and CDN layers. Every private route verifies the signed session and scopes D1 reads and writes to the authenticated user.
4. Remove request-bound translation promises, isolate-global dictionaries, and public translation-dictionary APIs. Ship only source-hash-exact curated static bundles.
5. Move topic and translation synchronization to explicit, idempotent release steps. Normal topic and translation reads are static or read-only.
6. Retire incremental page caching, OpenNext R2 cache reads, and request-time revalidation. Keep the migrated Durable Object class and binding only as a dormant rollback-compatible tombstone.
7. Remove the eSlams-inspired game arena, game routes, game APIs, and game assets. Retire `ai-game-arena` in the managed topic transaction.
8. Bound every request body, response materialization, D1 query, background queue read, and quota window. Authenticated provider SSE now passes through without Worker parsing; the browser submits one bounded, ownership-rechecked, idempotent finalize request to persist the answer and trigger memory. Keep the global LLM budget fail-closed.
9. Keep production on Workers Free with no paid-only `limits.cpu_ms` setting. Validate the exact uploaded version under live tail and require every sampled request to remain below the 10 ms Free-plan CPU ceiling.

## Release invariants

- `wrangler.jsonc` must not contain `cache.enabled: true`.
- `wrangler.jsonc` must not set a paid-only CPU allowance; the release is designed and tested for Workers Free's 10 ms request ceiling.
- Static Assets must bypass the Worker except for the exact native API and legacy chat-child paths listed in `run_worker_first`; `!/_next/static/*` must remain as the higher-precedence exclusion because Cloudflare wildcard matches are deep.
- The dormant `NEXT_CACHE_DO_QUEUE` binding and migrated class remain rollback-compatible but must receive no normal traffic.
- Auth cookie variants must never return `CF-Cache-Status: HIT` and must always return private/no-store.
- Localized routes publish only complete, source-hash-exact curated copy; they never publish an English body with a non-English `lang` value.
- A 69-locale production soak must return only successful pages or canonical redirects without 1102/5xx outcomes.
- `/api/health` must identify the exact version and report `openNext: false`, `games: false`, and the restored account/state surfaces.
- Authenticated tutor responses must remain pass-through streams; `/api/chat/finalize` must be independently sampled below the release CPU threshold and must never save across a session-owned chat boundary.
- Accounts, saved chats, messages, memory, sessions, admin membership, and profile objects must retain their historical identifiers and row counts across deployment.
- Every active topic must resolve to a shipped experience; `ai-game-arena` is retired in the post-deploy seed transaction.

## Relaunch baseline

- Pre-remediation production Worker version: `84252122-b8ca-4226-af55-05db2906b2f2`.
- Pre-remediation OpenNext build ID: `Zc9XxoyRGMm9AMhoWkpR7`.

The historical Durable Object migration remains in place because Cloudflare migrations are not reversed with application code. The final application release uses a native Worker plus Static Assets, pins and verifies the exact uploaded version, keeps split traffic disabled, and treats the dormant class solely as a safe rollback boundary.
