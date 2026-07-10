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
| Forced dynamic pages | `/chat`, `/admin`, `/reset_pw`, their subpaths, and their one-prefix localized forms | Worker first, as configured by the exact `assets.run_worker_first` allowlist | Private or user-specific responses must be `private, no-store` |
| APIs | Only the concrete API endpoints/prefixes present in `app/api` and mirrored by deploy preflight | Worker first, including when an asset path could collide | Each route owns authorization, user scoping, validation, and cache policy |
| Unknown or removed paths | Unknown public/API paths, unsupported localized documents, `/games`, retired translation APIs, legacy `/og` | Direct Workers Static Asset `404`; no Worker invocation | `X-Inspir-Delivery: static-assets`; public revalidation policy; no OpenNext headers |

The removed game surface has no runtime route, API, install manifest, or Static Asset. `/games` is expected to return `404`.

`www.inspirlearning.com` is not an application route. The current credential can write Worker routes but cannot edit zone Redirect Rules, so `wrangler.www-redirect.jsonc` deploys a tiny Worker Route at `www.inspirlearning.com/*`. Worker Routes take precedence over the main Custom Domain. The route Worker returns `308` to the identical path and query on `https://inspirlearning.com` and identifies the delivery path with `X-Inspir-Delivery: www-redirect-worker`. Both Custom Domains remain configured for DNS/certificate continuity; Next middleware is only defense in depth for dynamic and local execution.

A zone-level Single Redirect is an optional future optimization because it would canonicalize `www` without a Worker invocation. It requires separate Single Redirect edit permission and is not managed by Wrangler. Do not remove the route Worker unless the zone rule, exact path/query behavior, zero-invocation evidence, verifier changes, and rollback plan ship together.

## Static Public Documents

`pnpm cf:build` materializes eligible OpenNext cache entries into `.open-next/assets`. The materializer fails closed when required documents (including the PWA manifest) are missing, when the locale/document floor is not met, when Cloudflare asset limits are exceeded, when a removed route appears in the output, or when static HTML references the billable `/_next/image` optimizer. Next image optimization is globally disabled for this deployment; browsers request the cached source image directly. `.open-next/static-marketing-assets-report.json` records the exact generated paths, build ID, budgets, and output hash.

Public HTML must be served with `X-Inspir-Delivery: static-assets`. This is operational evidence that the request bypassed the Worker; `CF-Cache-Status` alone is not sufficient because a cache miss can still invoke Worker code. Public documents must not rely on `x-nextjs-cache`, `x-opennext-cache`, OpenNext ISR revalidation, or managed HTML Cache Rules for availability.

Static layouts may load the configured external analytics scripts, but they do not mount the D1-backed `ProductAnalytics` beacon. Product-event writes remain a workspace interaction concern. The global static `404` uses plain document links with no RSC prefetch, so an idle unknown-path visit is also main-Worker quiet.

The OpenNext R2 incremental-cache binding and Durable Object queue remain configured for framework compatibility and safe rollback across the already-applied migration. They are not the production delivery path for public marketing or localized HTML.

## Multilingual Routing and Translation

Localized marketing HTML is deploy-time immutable. It is released as a source-current Static Asset, never repaired or regenerated during a visitor request.

The language picker writes bounded locale preference cookies in the browser and performs a full document navigation. It does not call a language-preference API. Full navigation is intentional: the destination is an HTML Static Asset rather than a React Server Component response from the Worker.

Only route/language pairs backed by complete, source-hash-exact curated packs committed with the release are materialized. Generated links use canonical English when coverage is missing. A direct unsupported localized URL receives the static `404`, so it cannot spend Worker CPU or publish partial English fallback copy under a locale URL.

D1 remains the operational translation store and source-manifest audit trail. The confirmed SEO repair path validates all extracted namespaces, computes an incremental source diff under a conservative Workers Free write budget, and applies that diff with all 69 target-language payload repairs in one atomic SQL file. Build-time eligibility still comes from committed curated packs, so a D1 row alone does not authorize a route for static publication.

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

`assets.not_found_handling` is `404-page`, and the selective `run_worker_first` array is an exact allowlist enforced by deploy preflight. It includes every concrete API surface plus unprefixed/localized chat, admin, and reset-password paths. Because Cloudflare `*` route patterns match deeply, the higher-precedence `!/_next/static/*` rule keeps route-group and dynamic-segment client chunks on Static Assets even when their generated filenames contain `/chat/` or `/admin/`. The allowlist deliberately does not include broad `/api/*`, public marketing prefixes, removed endpoints, or `/og`; metadata uses the immutable `/inspir-social-preview.png` asset.

- `/api/health` is dynamic, version-attributed, and `private, no-store` so release verification can prove which Worker is active.
- `/api/topics` is a public D1-backed catalog endpoint with a bounded public freshness policy; it stays dynamic because administrators can change catalog rows.
- `/api/guest-chat` is a dynamic streaming POST. Its first-turn response cache is application-owned in D1, keyed by normalized request inputs and prompt/model policy, and used only for unpersonalized empty-history requests.
- `inspirlearning-www-redirect` is a separate minimal Free-plan Worker with no application bindings or rendering. It performs only URL normalization and a `308`; its invocation must never enter the main OpenNext Worker.
- Signed-in chat, profile, memory, activity, auth, admin, migration, and cron routes are dynamic and must authorize at the route/query boundary.
- Mutations must use bounded schemas, bounded history, bounded query results, and bounded retries. Global LLM spend limits fail closed.
- Background memory work belongs on the configured Queue; request handlers must not perform unbounded post-response work or leave floating promises.

The first-turn guest cache must not serve history-bearing, signed-in, memory-backed, profile-personalized, admin, auth, or mutating traffic. Guest quotas require server-derived buckets and bounded request history; client-resettable state is never the only key.

## Cache Boundaries

- Do not enable Worker-wide caching.
- Do not add a managed HTML Cache Rule or deployment purge for public documents. Static Assets provide their delivery and release invalidation boundary.
- Static HTML and SEO responses are public and carry the Static Asset delivery marker.
- Canonical `www` responses are public `308` responses with bounded caching and the redirect Worker delivery marker.
- Versioned `/_next/static/*`, media, and the release-owned social image may use long-lived immutable caching.
- Authenticated, private, mutating, health, and operational responses use `private, no-store` and must never produce a shared-cache hit.
- A new public dynamic GET must set a deliberately bounded cache policy and be added to the delivery map with the reason it cannot be a build-time asset.

## Adding or Changing a Route

Before merging a route change, decide its delivery class explicitly:

1. If the output is known at build time, make it statically generatable and prove it appears in the materialization report.
2. If it is private, mutating, personalized, or operational, keep it dynamic, enforce authorization in the route, and return `private, no-store` where state could leak.
3. If a public dynamic endpoint is unavoidable, bound its D1 work and payload, document its freshness policy, and add its exact path to the Worker-first allowlist and deploy-preflight contract.
4. Never restore a broad `/api/*`, locale, or catch-all Worker-first pattern. Unlisted asset misses must remain direct Static Asset 404s.
5. Add production verification for the correct delivery marker, cache policy, canonical behavior, and Worker outcome.

The release is not healthy unless deployment status shows the expected main version alone at 100%, an unpinned health request reports that UUID, public documents and 404s carry `X-Inspir-Delivery: static-assets`, canonical `www` responses carry `X-Inspir-Delivery: www-redirect-worker`, static requests are absent from the main Worker tail, every nonce-tagged dynamic probe is captured, and every sampled invocation completes with outcome `ok` below the 8 ms headroom threshold.
