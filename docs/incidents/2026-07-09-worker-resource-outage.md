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
- The Worker bundle remained around 2.73 MB compressed and startup remained under 100 ms, below platform limits. Raising `limits.cpu_ms` would only hide the leak and stampede.

## Remediation

1. Replace OpenNext's dummy queue with the SQLite Durable Object queue, serialize revalidation, wrap R2 with a regional cache, and enable cache interception.
2. Remove Worker-wide caching; retain only the route-scoped public marketing cache rule. Force all Better Auth responses private/no-store at browser and CDN layers.
3. Remove request-bound translation promises and unbounded dictionaries from isolate-global maps. Remove unused public translation dictionary APIs and use an exact generated namespace allowlist.
4. Generate localized HTML only for source-hash-exact curated route coverage, commit the build inputs, and make localized output immutable between deployments.
5. Move topic synchronization to an explicit, idempotent batched release step with a final completion marker, and reconcile retired managed topics. Normal topic reads are read-only.
6. Gate OpenNext output at 256 MB total, 128 MB cache, 400 cache entries, 80 localized entries, and 2 MB per cache entry.
7. Run deterministic game engines in isolated client bundles. The Worker only validates and stores completed, bounded results; game turns make no LLM calls.
8. Never expire the active R2 cache prefix. After a verified release, add retention only to the prior build-specific prefix so rollback objects remain temporarily available without creating a future regeneration stampede.

## Release invariants

- `wrangler.jsonc` must not contain `cache.enabled: true`.
- Localized edge-cache rules enumerate only source-hash-proven public page paths; locale-wide prefixes are forbidden.
- `NEXT_CACHE_DO_QUEUE`, its SQLite migration, regional R2 caching, and serialized queue vars must pass deploy preflight.
- Auth cookie variants must never return `CF-Cache-Status: HIT` and must always return private/no-store.
- Localized routes without complete curated coverage redirect to canonical English; they never publish an English body with a non-English `lang` value.
- A 69-locale production soak must return only successful pages or canonical redirects without 1102/5xx outcomes.
- `/api/cache-health` must advance after its five-second TTL, proving real queue-backed revalidation.
- Every active topic must resolve to a shipped experience; `ai-game-arena` is retired in the post-deploy seed transaction.

## Relaunch baseline

- Pre-remediation production Worker version: `84252122-b8ca-4226-af55-05db2906b2f2`.
- Pre-remediation OpenNext build ID: `Zc9XxoyRGMm9AMhoWkpR7`.

The first Durable Object migration is shipped as its own atomic, rollback-compatible infrastructure release built from the active production source. The application release follows as a second atomic deployment. Split traffic remains disabled while stock OpenNext queue self-calls cannot carry a version override; every production gate instead pins and asserts the exact single active version.
