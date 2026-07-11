# Runtime Route Policy

Inspir uses a static-first Cloudflare Workers Free architecture. OpenNext builds the application, then the deploy pipeline turns every eligible prerendered public document into a Workers Static Asset. A public page that can be known at deploy time must not spend Worker CPU at request time.

## Delivery Map

| Route class | Examples | Production delivery | Cache and state contract |
| --- | --- | --- | --- |
| Public documents | `/`, marketing pages, supported localized pages, generated comparison/audience/subject/learn pages, privacy, terms | Direct Workers Static Assets; no Worker invocation | `X-Inspir-Delivery: static-assets`; public document caching; no response cookie |
| SEO, discovery, and PWA metadata | `/robots.txt`, `/sitemap.xml`, `/sitemap/:locale.xml`, `/rss.xml`, `/llms.txt`, `/llms-full.txt`, `/ai-content-index.json`, `/manifest.webmanifest` | Direct Workers Static Assets | Deployed with the same versioned asset manifest as the app |
| Immutable frontend assets | `/_next/static/*`, `/media/*`, `/inspir-social-preview.png` | Direct Workers Static Assets | Long-lived `public, immutable` caching for content-addressed or release-owned files |
| Static redirect | `/tnc` | Native `_redirects` `308` to `/terms`; no Worker invocation | Exact permanent legal canonicalization before Static Asset headers |
| Canonical host | `www.inspirlearning.com/*` | Separate `inspirlearning-www-redirect` route Worker ahead of the main Custom Domain | `308` to the exact apex path/query; `X-Inspir-Delivery: www-redirect-worker`; bounded public caching |
| Public topic workspace | `/chat?topic=:topic` and localized equivalents | Direct Workers Static Assets; validated query selects a seeded topic | Guest-only, `noindex, follow`; content-addressed main-app bundle for the selected language |
| Legacy public topic URL | Exact seeded `/chat/:topic` and localized equivalents | Native `_redirects` `308` to the query-based static chat shell; no Worker invocation | English rules are exact/static; one localized placeholder rule per seeded topic stays below Cloudflare's 100 dynamic-rule limit |
| Public topic catalogue | `/api/topics` | Prerendered JSON Static Asset | Seeded at build time; bounded public cache policy; no D1 read |
| Lean native APIs | `/api/health`, `/api/guest-chat` | The only main-Worker routes | `X-Inspir-Delivery: lean-api-worker`; `private, no-store`; no Next/OpenNext runtime |
| Unknown or removed paths | Unknown public/API paths, unsupported localized documents, `/games`, retired translation APIs, legacy `/og` | Direct Workers Static Asset `404`; no Worker invocation | `X-Inspir-Delivery: static-assets`; public revalidation policy; no OpenNext headers |

The removed game surface has no runtime route, API, install manifest, or Static Asset. `/games` is expected to return `404`.

`www.inspirlearning.com` is not an application route. The current credential can write Worker routes but cannot edit zone Redirect Rules, so `wrangler.www-redirect.jsonc` deploys a tiny Worker Route at `www.inspirlearning.com/*`. Worker Routes take precedence over the main Custom Domain. The route Worker returns `308` to the identical path and query on `https://inspirlearning.com` and identifies the delivery path with `X-Inspir-Delivery: www-redirect-worker`. Both Custom Domains remain configured for DNS/certificate continuity; Next middleware is only defense in depth for dynamic and local execution.

A zone-level Single Redirect is an optional future optimization because it would canonicalize `www` without a Worker invocation. It requires separate Single Redirect edit permission and is not managed by Wrangler. Do not remove the route Worker unless the zone rule, exact path/query behavior, zero-invocation evidence, verifier changes, and rollback plan ship together.

## Static Public Documents

`pnpm cf:build` materializes eligible OpenNext cache entries into `.open-next/assets`. The materializer fails closed when required documents (including the PWA manifest) are missing, when the locale/document floor is not met, when Cloudflare asset limits are exceeded, when a removed route appears in the output, or when static HTML references the billable `/_next/image` optimizer. Next image optimization is globally disabled for this deployment; browsers request the cached source image directly. `.open-next/static-marketing-assets-report.json` records the exact generated paths, build ID, budgets, and output hash.

Public HTML must be served with `X-Inspir-Delivery: static-assets`. This is operational evidence that the request bypassed the Worker; `CF-Cache-Status` alone is not sufficient because a cache miss can still invoke Worker code. Public documents must not rely on `x-nextjs-cache`, `x-opennext-cache`, OpenNext ISR revalidation, or managed HTML Cache Rules for availability.

Static layouts may load the configured external analytics scripts, but they do not mount the D1-backed `ProductAnalytics` beacon. Product-event writes remain a workspace interaction concern. The global static `404` uses plain document links with no RSC prefetch, so an idle unknown-path visit is also main-Worker quiet.

The OpenNext R2 incremental-cache binding is removed. The existing Durable Object class, migration tag, and self binding remain only to preserve rollback compatibility after the already-applied migration; normal production traffic never calls them.

## Multilingual Routing and Translation

Localized marketing HTML is deploy-time immutable. It is released as a source-current Static Asset, never repaired or regenerated during a visitor request.

The language picker writes bounded locale preference cookies in the browser and performs a full document navigation. It does not call a language-preference API. Full navigation is intentional: the destination is an HTML Static Asset rather than a React Server Component response from the Worker.

Only route/language pairs backed by complete, source-hash-exact curated packs committed with the release are materialized. Generated links use canonical English when coverage is missing. A direct unsupported localized URL receives the static `404`, so it cannot spend Worker CPU or publish partial English fallback copy under a locale URL.

D1 remains the operational translation source-manifest audit trail. The confirmed SEO repair path validates all extracted namespaces, computes an incremental source diff under a conservative Workers Free write budget, removes retired private/game keys, and applies the audited CTA repairs for all 69 target languages in one atomic SQL file. Build-time eligibility still comes from committed curated packs, so a D1 row alone does not authorize a route for static publication.

For new or changed public copy:

1. update the typed source and regenerate the site source manifest;
2. supply valid NFC translations for every claimed language and preserve stable translation keys;
3. validate exact source hashes and field completeness;
4. commit the curated route packs used by static generation;
5. run the read-only translation repair/validation and the full Cloudflare build gates;
6. synchronize D1 only through an explicit, backed-up, production-confirmed command.

Do not expand DOM-walking translation. Public copy should use render-time typed lookup from curated bundles or audited D1 data.

## Dynamic Worker Surfaces

`wrangler.jsonc` deliberately has no `limits.cpu_ms` because Workers Free rejects configurable CPU limits. Every request that reaches the Worker must fit the platform's 10 ms CPU ceiling. External network wait time is not permission for unbounded parsing, rendering, retries, replay, or database work.

`assets.not_found_handling` is `404-page`, and `run_worker_first` is the exact two-entry allowlist `/api/health` and `/api/guest-chat`. There are no globs or exclusions. Unknown GETs resolve to the Static Asset 404, while unsupported mutation methods receive the Static Asset router's 405 without entering application code.

- `/api/health` is a tiny native, version-attributed, `private, no-store` response so release verification can prove which Worker is active.
- `/api/topics` is build-time seeded JSON and never invokes the Worker.
- `/api/guest-chat` is a native streaming POST. It validates a bounded strict JSON contract, consumes D1-backed IP/fingerprint/session quotas, fails closed on the global daily LLM ceiling, and passes the provider's SSE body through without parsing token chunks in the Worker.
- `inspirlearning-www-redirect` is a separate minimal Free-plan Worker with no application bindings or rendering. It performs only URL normalization and a `308`; its invocation must never enter the main OpenNext Worker.
- Signed-in chat, profiles, saved state, memory, generated quizzes/flashcards, auth, admin, migration, cron, queues, and games are deliberately not production surfaces on the Free architecture.
- Retired source files may remain for build history or future paid architecture work, but the Static Asset router makes them unreachable in production.

Guest quotas require server-derived buckets and bounded request history; client-resettable state is never the only key. Per-guest D1 failure may fail open with a structured warning for availability. The global LLM ceiling always fails closed.

## Cache Boundaries

- Do not enable Worker-wide caching.
- Do not add a managed HTML Cache Rule or deployment purge for public documents. Static Assets provide their delivery and release invalidation boundary.
- Static HTML and SEO responses are public and carry the Static Asset delivery marker.
- Canonical `www` responses are public `308` responses with bounded caching and the redirect Worker delivery marker.
- Versioned `/_next/static/*`, media, and the release-owned social image may use long-lived immutable caching.
- The two lean API responses use `private, no-store` and must never produce a shared-cache hit.
- A new public dynamic GET must set a deliberately bounded cache policy and be added to the delivery map with the reason it cannot be a build-time asset.

## Adding or Changing a Route

Before merging a route change, decide its delivery class explicitly:

1. If the output is known at build time, make it statically generatable and prove it appears in the materialization report.
2. Private, mutating, personalized, account, admin, and background surfaces are outside the current Free production scope; adding one requires an explicit architecture and quota review rather than merely exposing an existing Next route.
3. If a public dynamic endpoint is unavoidable, implement it in the dependency-minimal native Worker, bound its D1 work and payload, document its freshness policy, and add its exact path to the Worker-first allowlist and deploy-preflight contract.
4. Never restore a broad `/api/*`, locale, or catch-all Worker-first pattern. Unlisted asset misses must remain direct Static Asset 404s.
5. Add production verification for the correct delivery marker, cache policy, canonical behavior, and Worker outcome.

The release is not healthy unless deployment status shows the expected main version alone at 100%, an unpinned health request reports that UUID, public documents and 404s carry `X-Inspir-Delivery: static-assets`, canonical `www` responses carry `X-Inspir-Delivery: www-redirect-worker`, static requests are absent from the main Worker tail, every nonce-tagged dynamic probe is captured, and every sampled invocation completes with outcome `ok` below the 8 ms headroom threshold.
