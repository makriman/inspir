# inspir — Full Repo Review (2026-06-11)

Scope: every config file, all API routes, auth, the database layer, the AI/memory pipeline, i18n, SEO/sitemap, key pages/components, scripts, and tests. Baseline health: `pnpm typecheck`, `pnpm lint`, and `pnpm test` (85 tests) all pass.

Severity legend: 🔴 fix soon (cost/security/correctness) · 🟠 high value (performance/SEO) · 🟡 worth doing · ⚪ note/nit

---

## 1. Cost & abuse exposure (most urgent for a free product)

### 🔴 1.1 Rate limiting does not work on Vercel — at all
[lib/utils/rate-limit.ts](../lib/utils/rate-limit.ts) is an in-memory `Map`. On serverless, every lambda instance has its own memory and instances are created/recycled constantly, so:

- The "60 messages/day" cap in [app/api/chat/route.ts:50](../app/api/chat/route.ts) resets on every cold start and is not shared across concurrent instances.
- The guest per-IP cap (50/day) in [app/api/guest-chat/route.ts:92](../app/api/guest-chat/route.ts) has the same problem.

Combined with 1.2, **an anonymous user can make effectively unlimited OpenAI calls on your bill**. This is the single biggest risk in the repo.

**Fix:** back the limiter with durable shared storage — Upstash Redis / Vercel KV (one `INCR` + `EXPIRE` per check), or a small Postgres table (`user_id, window_start, count` with an upsert). Also: the `Map` grows unboundedly (a slow memory leak on long-lived instances), and the limit is consumed *before* request validation, so invalid payloads burn quota.

### 🔴 1.2 Guest limits are enforced by client-controlled cookies
[app/api/guest-chat/route.ts:77-98](../app/api/guest-chat/route.ts) trusts `inspir_guest_messages_used` (a cookie the client can simply delete) and a session-id cookie that the client can also reset. The in-memory backstop (1.1) doesn't hold. Anyone can script unlimited guest chats.

**Fix:** key guest quota on IP (+ lightweight fingerprint if you like) in durable storage, and treat the cookie as UX-only. Consider a global daily spend circuit-breaker (count OpenAI calls per day in the DB; refuse politely past a threshold) so a bad night can't run away.

### 🔴 1.3 No rate limit at all on the other LLM endpoints
- `POST /api/activities/quiz` ([route.ts](../app/api/activities/quiz/route.ts)) → `generateQuiz` (LLM call), no limit.
- `POST /api/activities/flashcards` — same pattern.
- `PATCH /api/memory` with `refreshSummary`/`correction` triggers `synthesizeUserMemory` (multiple LLM calls), no limit.

Any signed-in user can loop these.

### 🟠 1.4 The memory pipeline multiplies LLM spend per chat message
For one user message, the worst-case sequence is: memory gate (`generateObject`) + query embedding + retrieval, then post-turn: extraction (`generateObject`) + 2 embeddings + one `compileUserMemoryProfile` (`generateObject`) *per changed category* + a post-turn `synthesizeUserMemory` (another `generateObject`) whenever any category changed ([lib/ai/memory.ts:914](../lib/ai/memory.ts), `shouldSynthesizeAfterTurn` returns true for ≥1 change). That can be **4–7 auxiliary LLM/embedding calls per tutoring answer**.

**Suggestions:**
- Make post-turn synthesis much rarer (e.g. every N changed turns, or leave it to the nightly cron only — you already have `memory-dreaming`).
- Skip the LLM gate when the heuristic (`shouldUseMemoryHeuristic`) says "generic" — today the heuristic is only the fallback; inverting it (heuristic prefilter → LLM only on ambiguity) would remove the gate call from the majority of turns.
- Batch profile compilation per category change instead of on every PATCH/DELETE of a memory.

---

## 2. Security

### 🔴 2.1 System prompts are publicly exposed
Two paths leak every topic's `systemPrompt`:
1. `GET /api/topics` ([route.ts](../app/api/topics/route.ts)) is unauthenticated and returns `getActiveTopics()` rows verbatim — `select()` with no column list ([lib/db/queries.ts:41](../lib/db/queries.ts)).
2. Chat pages pass full topic rows into the client component: `topics={topics}` in [app/chat/[chatId]/page.tsx:381](../app/chat/%5BchatId%5D/page.tsx). The narrowed `Topic` type in ChatClient doesn't strip data — RSC serializes the actual objects, so all 86 system prompts (plus `legacyBubbleId`, timestamps, etc.) ship in the page payload of every chat view.

Your prompts are part of the product's quality moat and they also embed your safety instructions. **Fix:** add a `publicTopicColumns` projection (id, slug, name, subText, description, inputboxText, iconUrl, sortOrder, safe subset of metadata) and use it for `/api/topics` and all props passed to client components. This also cuts a lot of payload weight (see 3.4).

### 🔴 2.2 Cron endpoint is open if `CRON_SECRET` is unset, and accepts the secret via query string
[app/api/cron/memory-dreaming/route.ts:10-15](../app/api/cron/memory-dreaming/route.ts):
```ts
if (secret && auth !== `Bearer ${secret}` && querySecret !== secret) { ... 401 }
```
- If the env var is missing (new environment, typo), the check is skipped entirely and anyone can trigger up to 25 user-synthesis runs (LLM spend + DB writes) per request.
- `?secret=` puts the secret in access logs/analytics/referrers.
- `CRON_SECRET` is missing from [.env.example](../.env.example), which makes the "unset" case likely.

**Fix:** fail closed (`if (!secret || auth !== ...) return 401`), drop the query-param path (Vercel cron sends the `Authorization` header automatically), add `CRON_SECRET` to `.env.example`.

### 🟠 2.3 Missing security headers
[next.config.ts](../next.config.ts) sets nosniff/referrer/permissions-policy but has:
- **No `Content-Security-Policy`** — even a conservative report-only policy would be a good start for an app rendering LLM output (you do render markdown through react-markdown which escapes HTML by default — good — but CSP is your second layer).
- **No `X-Frame-Options` / `frame-ancestors`** — the chat app and admin page can be iframed (clickjacking).
- **No `Strict-Transport-Security`** — Vercel does not add HSTS unless you opt in.

### 🟡 2.4 `allowDangerousEmailAccountLinking: true`
[lib/auth/config.ts:29](../lib/auth/config.ts). Acceptable while Google is the *only* provider (Google verifies emails), but it becomes an account-takeover vector the day a second provider is added. Leave a loud comment, or scope linking logic per provider.

### 🟡 2.5 Cookies missing `secure`
The locale cookie is set without `secure: true` both in the proxy ([proxy.ts:62](../proxy.ts)) and in [app/api/language-preference/route.ts:21-30](../app/api/language-preference/route.ts) (the guest-chat cookies do it right). Low impact (it's a language name) but trivially fixed and avoids mixed-flag warnings.

### 🟡 2.6 Real user PII sits inside the project folder
`Export from Bubble/` contains ~3.2 MB of user rows (emails) and full chat/message exports. It is gitignored (verified: not tracked), but it lives in a directory that gets backed up, synced, indexed by tools, and shared with AI assistants. Move it outside the repo (or into an encrypted archive) now that the import is done. Same for `tmp/*.log` if any contain prod data.

### ⚪ 2.7 Small ones
- `/api/memory/source-feedback` records `aiRunId` without verifying the run belongs to the caller (analytics pollution only).
- `proxy.ts` reads the JWT secret without `.trim()` while `auth/config.ts` trims — a stray whitespace in the env var would break proxy auth confusingly.
- Unauthenticated users redirected away from private chats land on `/` with no callback/sign-in hint ([proxy.ts:77](../proxy.ts)) — UX more than security.
- `getRecentChats` doesn't escape `%`/`_` in the search term (LIKE wildcards, not injection — parameterized correctly).

---

## 3. Performance

### 🔴 3.1 `ensureSeedTopics()` fires 86 upserts on every topic read — and silently reverts admin edits
[lib/db/queries.ts:7-48](../lib/db/queries.ts): both `getActiveTopics()` and `getDefaultTopic()` call `ensureSeedTopics()`, which runs **86 `INSERT ... ON CONFLICT DO UPDATE` statements in parallel** (one per seed in `lib/content/topics.ts`). These run on:
- every unauthenticated `GET /api/topics`,
- every chat page view for a signed-in user,
- every private chat load (twice: `getActiveTopics` + `getDefaultTopic`),
- every guest chat message (`getGuestTopic`).

Two problems:
1. **Write amplification** — hundreds of needless writes per minute under modest traffic; Neon bills compute for this.
2. **Correctness** — the `onConflictDoUpdate` resets `name/subText/description/inputboxText/systemPrompt/sortOrder/metadata/status` to the seed values. Any edit an admin makes to a seeded topic via `/api/admin/topics` is **silently overwritten on the next read**. Only newly created (non-seed-slug) topics survive.

**Fix:** seed once — in a migration, a deploy step, or behind a "has seeding run for this seed-hash?" check (store a hash of `topicSeeds` in a one-row table and only upsert when it changes). Decide explicitly whether DB or code is the source of truth for seeded topics; right now it's both, and code wins at random times.

### 🔴 3.2 The whole site is dynamically rendered — including ~250 static marketing/blog pages × 69 locales
The root layout calls `getRequestLanguageConfig()` → `headers()` ([app/layout.tsx:126](../app/layout.tsx)), which opts **every route** into per-request rendering. There is no `revalidate`, no `use cache`, no static page anywhere except the few `force-static` route handlers. Consequences:

- Every page view (home, blog, subjects, compare, …) is a serverless invocation with TTFB at lambda speed instead of CDN speed.
- `getBlogPosts()` ([lib/content/blog.ts:80](../lib/content/blog.ts)) does `readdirSync` + ~90 × `readFileSync` + frontmatter parsing **per request** with no module-level cache, and it's called from the homepage, blog hub, categories, RSS, sitemaps, llms.txt…
- Marketing pages also await DB translation bundles per request (cached per-instance only).
- Googlebot crawling your 69-locale URL space (~17k URLs) hits lambdas every time.

**Fix options (in increasing ambition):**
1. Memoize `getBlogPosts()` at module level (1-line change, big win).
2. Stop reading `headers()` in the root layout: move `lang`/`dir` into a per-locale segment or set it client-side; let static pages be static.
3. The structural fix that matches your Next 16 version: enable **`cacheComponents`** and adopt `use cache` + Suspense for the marketing tree, or restructure to a real `[locale]` route segment with `generateStaticParams` so every locale page is prerendered/ISR. (See `node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md` — with cache components, routes can export `unstable_instant` to validate static shells.)

### 🟠 3.3 Base64 profile photos live in the `users` table and ride along on hot paths
`users.profileImageData` stores up to 512 KB of base64 ([lib/auth/profile-photo.ts](../lib/auth/profile-photo.ts)). `getUserById()` is `select().from(users)` — all columns — and it's called on **every chat message** ([app/api/chat/route.ts:70](../app/api/chat/route.ts)), every `/api/me`, every chat page load. So you potentially pull ~0.7 MB from Postgres per message just to read `preferredLanguage` and `dateOfBirth`. Worse, `GET /api/me` returns `{...user}`, so the **base64 blob (and email, legacy ids) is serialized into the JSON response**.

**Fix:** column projections (`getUserProfile()` without image data), serve the photo only via `/api/me/photo`, and longer-term move binary data to Vercel Blob/S3 or at least a `user_images` side table. Also consider firing `refreshProfilePhoto` via `after()` instead of awaiting it inside the sign-in event (it currently adds a network fetch + 2 queries to every login).

### 🟠 3.4 Chat page client payload
- Full topic rows × 86 with complete system prompts serialized into every chat page (see 2.1) — likely hundreds of KB of RSC payload before the user types anything.
- [components/chat/ChatClient.tsx](../components/chat/ChatClient.tsx) is **6,931 lines** in one `"use client"` file — one giant bundle for all 8+ workspace modes (quiz, flashcards, socratic, focus music, collaborative…). Split workspaces into `dynamic()`-imported chunks so a plain chat doesn't download the music player and collaboration sprint timer.
- [app/globals.css](../app/globals.css) is **15,014 lines** served to every visitor. Audit for dead rules; consider splitting app-shell CSS from marketing CSS.

### 🟠 3.5 Database connection management on serverless
[lib/db/client.ts](../lib/db/client.ts) uses `postgres-js` with `max: 10` per lambda instance. Under burst traffic on Vercel, N instances × 10 connections can exhaust Postgres/Neon connection limits. Either point `DATABASE_URL` at a pooled endpoint (Neon `-pooler`, PgBouncer) and drop `max` to 1–2 per instance, or actually use `@neondatabase/serverless` (HTTP driver) — it's in your dependencies but **never imported** (remove it if you don't adopt it).

### 🟡 3.6 Query-level items
- `GET /api/chats` does an N+1: `getChatPreview()` per chat, up to 100 sequential-ish queries ([app/api/chats/route.ts:22-27](../app/api/chats/route.ts)). One lateral join / `DISTINCT ON` query gets all previews.
- `getRecentChats` search uses `ilike(messages.content, '%q%')` — full scan on the messages table as it grows; add a `pg_trgm` GIN index on `messages.content` (or scope search to titles).
- `insertMessage` runs an extra `count()` on every user message just to detect "first message" ([lib/db/queries.ts:228-239](../lib/db/queries.ts)); you already know the context size in the chat route, or compare `value === 1` could be replaced by checking the chat's `title IS NULL`.
- `applyMemorySynthesis` calls `getActiveUserMemories(userId, 250)` **inside the per-update loop** when `update.id` is set ([lib/ai/memory.ts:1419](../lib/ai/memory.ts)) — hoist it.
- Vector search SQL is parameterized (safe) and HNSW indexes exist (good), but the extra `status/do_not_mention/freshness` filters mean pgvector post-filters; fine at current scale, just be aware.

### 🟡 3.7 Build/runtime config
- `outputFileTracingIncludes: { "/*": [ ... all app TS + all blog md ... ] }` ([next.config.ts:25](../next.config.ts)) copies the blog corpus and source into **every** serverless function. Scope to the routes that need it (`/blog/:path*`, sitemap, rss, llms) to shrink cold starts.
- `dev`/`build` force `--webpack`. Next 16 defaults to Turbopack, which is significantly faster; if webpack is a workaround for something, document it — otherwise try dropping the flag.
- `generateStaticParams` in [app/chat/[chatId]/page.tsx:233](../app/chat/%5BchatId%5D/page.tsx) is dead weight next to `export const dynamic = "force-dynamic"`.

---

## 4. SEO

### 🟠 4.1 Hidden SEO content on topic chat pages is a real penalty risk
`PublicTopicSeoCompanion` ([app/chat/[chatId]/page.tsx:69-222](../app/chat/%5BchatId%5D/page.tsx)) renders an entire H1 + FAQ + related-links section that is `aria-hidden`, `inert`, and visually clipped to 1×1 px (`.public-topic-seo.is-hidden-for-app` in globals.css). Content visible to crawlers but invisible to all users is the textbook definition of hidden text in Google's spam policies. The FAQ/ItemList JSON-LD also claims content the user can't see.

**Fix:** make it visible — e.g. render it *below* the chat as a normal collapsible "About this mode" section (details/summary works fine), or only render it for the logged-out landing state where it can be genuinely visible.

### 🟠 4.2 69-locale hreflang fan-out over untranslated, client-side-localized pages
The architecture: localized URLs (`/es/...`) are rewritten by the proxy to the same React tree; server HTML is **English**, and `MarketingDomLocalizer` rewrites DOM text after hydration. Meanwhile `metadataAlternates`/sitemaps declare hreflang alternates for **all 69 languages on every URL** (~250 URLs × 70 links × 69 sitemap files).

Risks: Google may see 69 near-identical English pages per URL (duplicate clustering, wasted crawl budget, hreflang ignored), and users on slow devices see an English flash before translation. The DB-translation work you've been doing is the right direction — but it only pays off for SEO if it's **server-rendered**.

**Suggestions:**
- Emit hreflang/sitemap entries only for locales that actually have a translation bundle for that page (you have `sourceHash`-validated rows in `app_translations` — use that as the gate).
- Server-render translations for the prioritized locales (per your `translation-import-priority` logs you already have a priority set) instead of DOM patching.
- `"content-language": "en-US"` and `openGraph.locale: "en_US"` are hardcoded in the root layout regardless of locale — make them follow the request language or drop them.

### 🟡 4.3 Programmatic blog content at scale
~90 of the blog posts are generated from one template (`scripts/generate-seo-blog-posts.ts`) with per-topic substitutions, including synthetic stagger-dated frontmatter (2 posts/day backwards from launch). This pattern is exactly what Google's "scaled content abuse" policy targets. The tests asserting "substantial indexed editorial depth at scale" don't change how it looks to a ranking system. Worth a deliberate decision: keep the strongest 10–20, enrich them by hand, and noindex or consolidate the long tail — better than risking a sitewide quality demotion.

### 🟡 4.4 OG/social images are all the same picture
`socialImage()` ignores `eyebrow`/`description` and always returns `/inspir-social-preview.png` ([lib/seo/config.ts:52](../lib/seo/config.ts)); `/og` just 308-redirects there. Every page, sitemap image entry, and share card is the identical brand image — the per-page image entries in the sitemaps are noise. Either build real dynamic OG images (`next/og` `ImageResponse` — you already have the route scaffolding) or drop the per-page image fields.

### ⚪ 4.5 Smaller SEO notes
- `staticLastModified` is frozen at 2026-05-29; a uniform stale `lastmod` across the whole sitemap teaches Google to ignore your lastmod. Tie it to build time or content hashes, or omit it for static routes.
- [app/tnc/page.tsx](../app/tnc/page.tsx) is dead — `next.config.ts` permanently redirects `/tnc` → `/terms`. Delete the page.
- `/loading` is a public indexable-ish route with full metadata + alternates for what is a spinner page (it is noindexed — fine — but it doesn't need 69 hreflang alternates).
- `keywords` meta is ignored by Google; harmless, removable.

---

## 5. Correctness & robustness

- 🟠 **Admin topic upsert can clobber an existing topic**: `POST /api/admin/topics` slugifies the name and `onConflictDoUpdate`s — creating "Debate Club" twice, or any name that slugifies to an existing seed slug, silently overwrites that topic (and then 3.1 reverts seeded ones anyway). Return 409 on conflict or require an explicit `overwrite` flag.
- 🟠 **Chats whose topic was deleted become unusable**: `getOwnedChat` left-joins topics and `/api/chat` requires `owned.topic` ([route.ts:61](../app/api/chat/route.ts)), so `topicId: set null` chats 404 on send. Fall back to the default topic or the `topicNameSnapshot`.
- 🟡 **Cached rejected promises in translation cache**: `dbBundleCache` ([lib/i18n/db-translations.ts:12-17](../lib/i18n/db-translations.ts)) stores the promise before it settles and never evicts on rejection — one transient DB error pins that namespace/language to a rejected promise for the life of the instance. `.catch(() => { dbBundleCache.delete(cacheKey); throw ... })` (or cache `null` results only).
- 🟡 **Read-modify-write races**: quiz answers (two concurrent `POST .../answer` can both read the same state; score double-award is possible) and `insertMessage`'s first-message title check. Low stakes, but a `WHERE status='active' AND state->>'currentIndex' = $n` guard or row lock would close it.
- 🟡 **`POST /api/chats` returns 500 on unknown topicId** (`createChatForUser` throws); validate and return 400/404.
- ⚪ `users.score` increments but there's no UI surfacing it yet (carried over from Bubble?) — either expose it or stop writing it.
- ⚪ `sessions`/`verificationTokens` tables are unused under `strategy: "jwt"` — harmless, but worth a comment so nobody assumes DB sessions exist.
- ⚪ `fallbackQuiz` puts the correct answer at index 1 for all 10 questions — only shown when OpenAI is down, but trivially gameable; rotate the index.
- ⚪ The proxy matcher `"/((?!api|_next/static|...|.*\\..*).*)"` skips any path containing a dot — today that's fine, but a blog slug or topic slug with a `.` would silently bypass locale handling and auth checks.
- ⚪ `memoryJobWithTimeout` is 90s inside `after()` while `maxDuration = 120` — if the stream itself ran long, the memory job gets killed mid-write; consider deriving the budget from remaining time.

## 6. Developer experience, tests, hygiene

- **Tests**: 85 passing tests, heavily weighted to SEO/content invariants (genuinely nice), plus memory heuristics. There are **zero tests for the money paths**: auth gating, chat route, rate limiting, guest quota, ownership checks (IDOR). Even a handful of route-handler tests with a stubbed DB would catch regressions in 1.x/2.x.
- `.env.example` is missing `CRON_SECRET`; it lists `APP_URL`, which nothing in the code reads — prune/extend so the example matches reality.
- Repo-root clutter: `historical-person-*.png`, `time-travel-departure.png`, `tsconfig.tsbuildinfo`, `test-results/` are committed at the root; move screenshots to `docs/` or delete, and gitignore `test-results/`.
- `public/media/inspir-learning-film.mp4` (2.3 MB) in git — fine today, but video iterations will bloat history; consider Blob storage/CDN for future media.
- `@neondatabase/serverless` (unused), `@testing-library/react`/`jest-dom` (no component tests use them) — drop or use.
- The cron processes users **sequentially** with `maxDuration: 120`; if synthesis takes ~10–20s/user, a limit of 10 already flirts with the timeout, and stats are lost on timeout. Process with `Promise.allSettled` in small batches and/or lower the default limit.
- `ChatClient.tsx` (6.9k lines), `lib/ai/memory.ts` (1.9k), `globals.css` (15k) are the three maintainability hotspots — each is past the point where a newcomer (or future you) can safely modify it.

## 7. Things that are genuinely good

- Parameterized SQL everywhere, including the pgvector queries; HNSW indexes with sensible partial conditions already in migrations.
- Ownership checks (`getOwnedChat`, user-scoped memory queries) are consistent across routes — I found no real IDOR.
- Quiz/flashcard state sanitization (`sanitizeQuizState`) correctly hides answers until answered.
- The memory system's privacy posture is thoughtful: sensitive-content filters, `doNotMention`, per-user toggles, feedback loop, "memory off" honesty in the prompt contract.
- Guest mode degrades gracefully when the DB or OpenAI is down (seed fallbacks, fallback quiz).
- `after()` for post-response memory work is the right Next 16 pattern, with timeouts.
- SEO plumbing breadth (sitemaps with video/image/hreflang, RSS, llms.txt, ai-content-index, JSON-LD everywhere) is far beyond typical for a project at this stage — the issues above are about *calibrating* it, not building it.
- Clean lint/typecheck/test baseline, strict TS, sensible Zod validation on every API input.

---

## Top 10 priority list

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | Durable rate limiting (chat, guest, activities) + spend circuit breaker | S–M | Stops unbounded OpenAI spend |
| 2 | Stop leaking `systemPrompt` (column projection for `/api/topics` + chat page props) | S | Security + payload size |
| 3 | Seed topics once, not per request (and stop reverting admin edits) | S | DB load + correctness |
| 4 | Fail-closed cron auth; header-only secret; add `CRON_SECRET` to `.env.example` | S | Security |
| 5 | Memoize `getBlogPosts()`; stop `headers()` in root layout; make marketing/blog static or cached | M | TTFB, cost, crawl |
| 6 | Column-project `getUserById` hot paths; keep base64 photo out of `/api/me` JSON | S | Latency + payload |
| 7 | Unhide the topic SEO companion (or move it to visible UI) | S | Avoids hidden-text penalty |
| 8 | Gate hreflang/sitemap entries on actually-translated locales; server-render priority locales | M–L | Multilingual SEO actually working |
| 9 | Reduce per-turn memory LLM calls (heuristic prefilter, rarer synthesis) | M | ~halves cost per message |
| 10 | Security headers: CSP (report-only first), `frame-ancestors`, HSTS | S | Defense in depth |

(S = under an hour, M = a day-ish, L = multi-day.)
