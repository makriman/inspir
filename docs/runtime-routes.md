# Runtime Route Policy

Inspir runs on Cloudflare Workers through OpenNext. Public and private routes should make their runtime cost explicit so dynamic rendering is a deliberate product choice, not an accident.

## Static Or Cacheable Public Routes

- `/robots.txt`, `/sitemap`, `/sitemap/:locale.xml`, `/rss.xml`, `/llms.txt`, `/llms-full.txt`, `/ai-content-index.json`, and `/og` are static or explicitly cacheable SEO/discovery surfaces.
- English marketing HTML is pre-rendered and may use bounded ISR backed by the OpenNext R2 incremental cache and the `NEXT_CACHE_DO_QUEUE` revalidation Durable Object.
- Localized marketing HTML is deploy-time immutable. Only route/language pairs with committed, source-hash-exact curated packs are generated; unavailable localized URLs redirect to canonical English.
- `/api/topics` is a public D1-backed catalog endpoint. It is intentionally dynamic because topic rows can change through admin tooling, but the response is CDN/browser cacheable for short freshness windows.
- Immutable media and social-preview assets are cached through `next.config.ts` headers.

## Intentionally Dynamic Public Routes

- Language preference writes are dynamic and private/no-store. A preference only redirects to a localized URL when that exact route has full curated coverage.
- Game result writes are bounded, rate-limited, and revalidated server-side; completed non-personal result reads are intentionally public.
- Do not add Worker-wide caching. Public marketing HTML uses a path-scoped Cloudflare cache rule with `/api` exclusion and authenticated-cookie bypass.

## Private And Mutating Routes

- Workspace pages, auth, chat, guest chat, profile, memory, activities, admin, migration, and cron endpoints remain `force-dynamic`.
- Private and mutating endpoints should return `no-store` where they expose user state or operational state.
- New public dynamic routes must either set bounded cache headers or be added here with the reason they cannot be cached.

## Explicit Application Caches

`/api/guest-chat` remains dynamic and is not a framework/CDN-cached POST route. It has an explicit app-owned D1 response cache for guest/public first-turn questions. This cache is keyed by normalized question, topic, language, model, model params, prompt hash, and cache policy version.

The response cache only serves requests with empty guest history, replays cached answers through the normal streaming response path, and returns before the global LLM budget is consumed. History-bearing, signed-in, memory-backed, profile-personalized, admin, auth, and mutating routes bypass this response cache.
