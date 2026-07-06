# Runtime Route Policy

Inspir runs on Cloudflare Workers through OpenNext. Public and private routes should make their runtime cost explicit so dynamic rendering is a deliberate product choice, not an accident.

## Static Or Cacheable Public Routes

- `/robots.txt`, `/sitemap`, `/sitemap/:locale.xml`, `/rss.xml`, `/llms.txt`, `/llms-full.txt`, `/ai-content-index.json`, and `/og` are static or explicitly cacheable SEO/discovery surfaces.
- `/api/topics` is a public D1-backed catalog endpoint. It is intentionally dynamic because topic rows can change through admin tooling, but the response is CDN/browser cacheable for short freshness windows.
- Immutable media and social-preview assets are cached through `next.config.ts` headers.

## Intentionally Dynamic Public Routes

- Marketing HTML under `app/(marketing)` is intentionally dynamic today. The layout reads middleware-provided request language/path headers and the locale cookie so preserved DB-backed translations continue to render exactly without regeneration.
- Localized marketing paths such as `/hi` rewrite to the canonical route tree while carrying the request language header. Do not add shared public HTML cache headers to those responses unless the cache key varies by original URL/language and `Set-Cookie` behavior is accounted for.
- A future static-marketing project may export the preserved translation tables into build-time bundles and pre-render localized routes, but that is a separate migration because translation fidelity is a hard requirement.

## Private And Mutating Routes

- Workspace pages, auth, chat, guest chat, profile, memory, activities, admin, migration, and cron endpoints remain `force-dynamic`.
- Private and mutating endpoints should return `no-store` where they expose user state or operational state.
- New public dynamic routes must either set bounded cache headers or be added here with the reason they cannot be cached.

## Explicit Application Caches

`/api/guest-chat` remains dynamic and is not a framework/CDN-cached POST route. It has an explicit app-owned D1 response cache for guest/public first-turn questions. This cache is keyed by normalized question, topic, language, model, model params, prompt hash, and cache policy version.

The response cache only serves requests with empty guest history, replays cached answers through the normal streaming response path, and returns before the global LLM budget is consumed. History-bearing, signed-in, memory-backed, profile-personalized, admin, auth, and mutating routes bypass this response cache.
