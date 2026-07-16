# Runtime Route Policy

Inspir uses a static-first, native-account architecture for Cloudflare Workers Free. OpenNext is a build tool only: it prerenders documents, and the deploy pipeline materializes eligible output into Workers Static Assets. The deployed request handler does not import Next or the OpenNext request runtime.

## Delivery map

| Route class | Examples | Production delivery | Contract |
| --- | --- | --- | --- |
| Public documents | `/`, marketing pages, supported localized pages, privacy, terms | Direct Workers Static Assets | `X-Inspir-Delivery: static-assets`; no D1 read or Worker invocation |
| SEO and PWA metadata | `/robots.txt`, `/sitemap.xml`, `/rss.xml`, `/llms.txt`, `/manifest.webmanifest` | Direct Workers Static Assets | Versioned with the application assets |
| Frontend assets | `/_next/static/*`, `/media/*`, `/i18n/main-app/*` | Direct Workers Static Assets | Content-addressed or release-owned immutable caching |
| Public topic catalogue | `/api/topics` | Prerendered JSON Static Asset | Seeded at build time; no prompt or private field |
| Chat shell | `/chat`, localized equivalents | Static HTML and client bootstrap | Starts as a guest shell, then checks `/api/me`; signed-in users receive profile, D1 topics, saved chat, memory, and admin capabilities |
| Account recovery | `/reset_pw` | Direct Workers Static Assets | No password form or private data; explains Google-only recovery and returns existing users to sign-in without invoking the Worker |
| Topic and saved-chat child URL | `/chat/:topic`, `/chat/:uuid` | Tiny native router | Known topics receive a `308` to the query shell; UUIDs receive the same static shell with private/no-store and load only through an ownership-checked API |
| Native account APIs | `/api/auth/*`, `/api/logout`, `/api/me`, `/api/me/photo` | Native Worker | Better Auth-compatible Google OAuth/session model; private/no-store; bounded bodies; no Next/OpenNext |
| Legacy localization compatibility | `/api/language-preference`, `/api/main-app-translations`, `/api/site-translations` | Tiny native adapter over release-owned Static Assets | Preserves pre-games cookie/JSON contracts for cached clients; the release contains 70 complete main-app envelopes plus 210 published site language/namespace envelopes, with no incomplete fallback assets and no request-time D1, translation provider, Next, or OpenNext work |
| Native saved-state APIs | `/api/chats/*`, `/api/memory/*` | Native Worker | Session and ownership checks in every handler; bounded raw D1 operations |
| Product event ingestion | `/api/analytics/events` | Native Worker | Bounded anonymous or signed events; server-derived identity when present; no client-trusted user ID and no private-data read |
| Native learning APIs | `/api/chat`, `/api/chat/finalize`, quiz/flashcard routes, `/api/account/topics` | Native Worker | User quota, fail-closed global LLM ceiling, pass-through streaming, ownership-scoped saved answers, and complete activity results |
| Native admin APIs | `/api/admin/dashboard`, `/api/admin/users`, `/api/admin/topics` | Native Worker | Session plus DB/bootstrap admin authorization in every handler; durable all-time totals come from one daily metadata snapshot while indexed window metrics stay live |
| Background memory and maintenance | daily cron, authenticated `GET /api/cron/memory-dreaming`, and `inspirlearning-memory-post-turn-prod` | Native HTTP/scheduled/Queue handlers | `CRON_SECRET` bearer authentication, write-freeze enforcement, bounded enqueue/prune, daily admin-total refresh, and deterministic D1 synthesis; no inline LLM/OpenNext work |
| Removed games | `/games`, game APIs and manifests | Static `404` | No game code, assets, route, binding, or deployment surface |

The separate `inspirlearning-www-redirect` Worker canonicalizes `www.inspirlearning.com/*` to the exact apex path/query. It is not an application runtime.

## Free-plan CPU boundary

`wrangler.jsonc` deliberately has no `limits.cpu_ms`; Workers Free rejects configurable CPU limits and enforces a 10 ms HTTP CPU ceiling. Every native route must be sampled below the repository's 8 ms release threshold so two milliseconds remain as operating headroom.

The exact `assets.run_worker_first` rules contain only the native routes above, the three exact legacy compatibility paths, narrow child globs, and the higher-precedence `!/_next/static/*` exclusion. Cloudflare `*` patterns match deeply, so the exclusion prevents chat route globs from intercepting immutable Next chunks whose generated path contains a `/chat/` segment. Broad `/api/*` and `/*` patterns are forbidden. Public HTML, SEO documents, `/api/topics`, backing translation assets (including content-addressed `/i18n/main-app/*` bundles), chunks, and media bypass the Worker.

Framework-neutral handlers use Web `Request`/`Response`, raw D1 statements, Web Crypto, R2, Vectorize, and Queues. They must not import `next`, `next/server`, `.open-next/worker.js`, or `@opennextjs/cloudflare`. Request bodies, cookies, history, D1 result sizes, provider responses, and persisted assistant output are bounded.

The legacy `NEXT_CACHE_DO_QUEUE` class, migration tag, and self binding remain only for rollback compatibility after the already-applied Durable Object migration. The native runtime does not call that cache queue, and the 14 GB OpenNext incremental-cache R2 bucket is not bound.

## Authorization and state

Static HTML is never treated as an authorization boundary. The chat and admin shells contain no private data. Each private API verifies the HMAC-signed Better Auth cookie, loads an unexpired D1 session, and scopes every read or mutation to `session.user.id`; admin APIs add a DB/bootstrap admin check.

Google remains the sole identity provider. Verified Google email may link to a migrated same-email user without changing that user's id, preserving historical chats and memory. Do not rotate `AUTH_SECRET`, rename cookies, recreate account tables, or rewrite user ids during a normal deploy.

Saved chat child URLs are safe to serve as a shell because messages are returned only after `/api/chats/:id` verifies ownership. Guest and unowned requests receive `401` or `404` from the API and never receive private state.

Saved-chat pages return at most 30 messages and 8,000 Unicode code points per message. When more content exists, message metadata carries the next character offset; `GET /api/chats/:chatId/messages/:messageId?offset=N` re-checks session and chat ownership, selects only the next bounded D1 `substr` chunk, and returns private/no-store `{ content, hasMore, nextOffset }` data without materializing the full message in the Worker.

## Memory and AI budgets

Guest chat keeps server-derived session, fingerprint, and IP buckets. Signed-in chat uses a user bucket. Per-user/guest quota-storage failures may fail open only where the handler logs the deliberate availability posture. The global LLM daily ceiling always fails closed.

Authenticated chat passes the provider SSE body straight to the browser without parsing or remounting token chunks in the Worker. After the browser has already decoded the bounded answer for display, it makes one idempotent `/api/chat/finalize` request carrying the run, chat, user-message, and answer values; the server rechecks the session and chat ownership, accepts only a still-pending matching run, atomically saves the assistant message, and enqueues post-turn memory. This deliberately trades one small authenticated request for removal of unbounded stream-parsing CPU from the Free Worker. Normal answers are capped at 800 completion tokens (1,200 for reasoning profiles), and the finalize JSON remains under the native 20 KiB request ceiling. Queue processing and daily synthesis are deterministic and bounded on Free; they do not invoke a second request-time LLM pipeline.

Explicit personal memory commands use a compile-time-complete lexicon for every supported language. Only anchored “remember this about me”, “forget this about me”, preference, and identity forms with a 5–600 character payload mutate memory; the queue applies the account's preferred-language lexicon plus typo-tolerant English fallback. Ordinary study requests such as “remember the planets” are not personal-memory writes. Creates and bounded deletes remain scoped to the queue job's already ownership-checked user/chat.

The memory cron endpoint preserves its historical GET-only contract. It requires `Authorization: Bearer <CRON_SECRET>`, never accepts a query-string secret, enqueues at most 25 due users, prunes at most 5,000 expired rate-limit windows through the `reset_at` index, returns private/no-store JSON, and performs no synthesis inline. The platform's daily scheduled event separately refreshes one `app_metadata` row containing durable admin totals and marks at most 500 client-unfinalized AI runs older than one hour as failed through the `created_at` index; ordinary admin requests read the bounded snapshot instead of recounting historical account and chat tables. Snapshot SQL excludes only the reserved `@inspirlearning.invalid` disposable validator and deliberately retains NULL/orphan historical chats, messages, and AI runs.

Profile images use `PROFILE_IMAGES_R2_BUCKET`; memory cleanup uses `MEMORY_VECTORIZE`; relational identity, chats, results, translations, and memory stay in D1. The memory Queue has a DLQ and bounded retry policy.

## Multilingual contract

Localized marketing HTML is deploy-time immutable. It is emitted only from source-hash-exact curated packs and is served directly by Workers Static Assets.

Translations are generated and validated offline. Static main-app bundles include the account, saved-chat, profile, memory, and admin copy for every supported language; the client does not walk the DOM to translate token updates. D1 mirrors audited source-current payloads, but page rendering does not fan out across D1 translation rows.

The legacy API matrix is an intentionally filtered compatibility surface, not a mirror of render-time availability or the complete D1 corpus. Every supported language has one complete main-app result, while the published site matrix is fixed to `marketing-shell`, `route:home`, and `route:mission` for every supported language: 70 + (70 × 3) = 280 complete release assets. The adapter performs one Static Assets lookup for a published pair. A known namespace outside that language's published matrix returns a private/no-store `404` without an asset lookup; an unknown namespace returns a private/no-store `400`; and a missing advertised asset is logged and fails closed with a private/no-store `503`. Incomplete responses are never materialized or served.

Only source-hash-exact curated route/language pairs may become localized public HTML. A direct unsupported localized URL receives the static `404` instead of shipping mixed English copy. New UI text must be added to the typed main-app source and all tracked language packs before deployment.

Generated links use canonical English when coverage is missing, so navigation never advertises a partially translated route.

## Adding or changing a route

1. Prefer a prerendered Static Asset when output is public and known at build time.
2. For private or mutating behavior, add a framework-neutral native handler with its own session, ownership/admin, schema, quota, cache, and write-freeze checks.
3. Add only the exact path or narrow child glob to `assets.run_worker_first`; never add `/api/*` or `/*`.
4. Add preview tests and a production-tail probe proving the expected status, delivery marker, cache policy, outcome, and CPU sample.
5. Keep games absent unless the product scope is explicitly changed again.

The release is healthy only when the expected version is alone at 100%, public static probes produce no main-Worker tail event, every native probe has outcome `ok`, no resource-limit log appears, and every sampled native invocation stays below 8 ms CPU.

Production release verification temporarily installs five bound Worker secrets: the operator-supplied exact existing admin email and 32–512-byte capability, plus wrapper-generated existing-user guard, mutation run UUID, and hard mint-expiry timestamp. Mint actions require the configured run, the active Worker version, and a live expiry no more than two hours ahead. Historical-account sessions are deterministic per run/version/purpose and never change that user's profile or admin membership; disposable mutations use a separate deterministic non-admin `@inspirlearning.invalid` user. The tail soak samples Google OAuth initiation first-use/warm before hidden authentication, then carries the returned session cookie through paired authenticated profile, saved-chat, memory, and admin probes. `E2E_TEST_AUTH_IS_ADMIN` is obsolete; admin authorization is accepted only when the server reports the configured/bootstrap admin.

The migration E2E route is a temporary release instrument, not a production login method. Both child validators and the parent wrapper exact-clean and independently verify the two historical validation sessions plus the complete disposable D1 graph before the capability is removed. Cleanup remains allowed after expiry and after an active-version change because it derives only the recorded run/candidate identity and can delete only HMAC-bound validation rows; minting remains pinned to the live active version. Every bound response also reports the actual runtime version, so an ignored Cloudflare version override cannot certify another version's empty inventory. The wrapper writes a private, fsynced recovery manifest before its first secret operation and removes it only after zero residue, all five secret names are authoritatively absent, and its global D1 lease is released with an exact absent readback. The lease is a non-secret, source/run/candidate/lease-generation-bound compare-and-swap row in `app_metadata`; it uses D1's clock, excludes concurrent validators across workspaces, fails closed on noncanonical, stale-generation, or live foreign ownership, reclaims an exact expired owner only through compare-and-swap, is attested around every secret mutation and authenticated child gate even after failures, and has a pre-reserved bounded D1 row/operation budget. Every production-mutating release, migration, sync, rollback, translation-repair, and authenticated-validation operation must hold that shared exclusion. A separate durable maintenance marker blocks all ordinary operations if translation repair becomes indeterminate; only the explicitly confirmed recovery command may restore the recorded candidate Worker and atomically clear that marker while holding the matching lease. Cross-store backup and destructive whole-D1 restore remain unsupported on Free. Confirm the route returns `404`, require the post-removal version alone at 100%, and rerun the secret-free tail CPU/resource gate before accepting the release. A real Google consent/callback round trip remains mandatory manual evidence whenever automation has no Google credentials.
