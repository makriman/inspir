# AI Response Cache

Inspir has an app-owned response cache for token-efficient public learning starts. The goal is simple: repeated safe starter questions should not repeatedly call OpenAI, while private, personalized, memory-backed chat remains fresh and user-specific.

## What Is Cached

- Surface: guest chat only.
- Scope: first-turn public starter questions where `messages` is empty.
- Storage: D1 table `ai_response_cache`.
- TTL: 30 days by default through `AI_RESPONSE_CACHE_TTL_SECONDS`.
- Size cap: `AI_RESPONSE_CACHE_MAX_RESPONSE_BYTES`, default 120000 bytes.
- Cache key: SHA-256 over cache policy version, topic id/slug, normalized question, language, model, model params, and topic system-prompt hash.

The cache stores only completed responses with finish reason `stop`. Failed, partial, length-truncated, content-filtered, private, memory-personalized, profile-personalized, admin, auth, and history-bearing requests are not cached.

## Runtime Behavior

Guest chat still applies IP, fingerprint, and session abuse quotas before cache lookup. On a cache hit, the route returns before consuming the global LLM budget, so cached answers avoid provider calls while preserving guest limits.

On a cache miss, the route consumes the global LLM budget, calls the model, streams the answer, and stores the final answer only after the stream finishes successfully.

Cache hits replay through the normal text streaming path, so the chat UI still receives incremental text rather than a sudden completed blob.

Diagnostic headers:

- `x-inspir-cache: hit | miss | bypass`
- `x-inspir-cache-reason: public-starter | guest-history`

## Provider Caching

OpenAI prompt caching is still useful when OpenAI reports `usage.prompt_tokens_details.cached_tokens`; Inspir records this as `cached_prompt_tokens` on `ai_runs` and response-cache entries.

Do not send `prompt_cache_key` from the current Chat Completions client. The official OpenAI docs expose `prompt_cache_key` for the Responses API path, while this app still uses Chat Completions. Revisit this only when the app migrates to Responses or the Chat Completions reference explicitly supports it.

Cloudflare AI Gateway response caching is not used for chat streaming. Cloudflare AI Gateway cache is useful for deterministic non-streaming calls, but this app-owned cache is the source of truth for streamed guest answer reuse.

## Ops Visibility

The admin dashboard shows:

- Response-cache daily hits, misses, stores, bypasses, and rejects.
- Active and stale cache entries.
- Total cache hits.
- Estimated saved prompt, completion, and total tokens.
- Top cached public starter topics.
- Provider-level cached input tokens on the AI usage table.

First-party product events:

- `ai_cache_hit`
- `ai_cache_miss`
- `ai_cache_store`
- `ai_cache_bypass`
- `ai_cache_reject`

Ops failure events:

- `ai_cache_read_failed`
- `ai_cache_hit_record_failed`
- `ai_cache_store_failed`

## Deployment Notes

Apply `drizzle-d1/0011_ai_response_cache.sql` before deploying code that reads the admin dashboard cache tables.

Safe order:

1. Run `pnpm cf:verify:local`.
2. Apply the D1 migration to production.
3. Deploy the Worker.
4. Run `REQUIRE_LIVE_AI=1 pnpm cf:verify:production`.
5. Check `/admin` for cache metrics after live guest traffic.

The route fails soft for cache reads, but the admin dashboard expects the table to exist.

## Future Semantic Cache

Semantic response caching is intentionally disabled by `AI_RESPONSE_CACHE_SEMANTIC_ENABLED=0`.

If added later, use a separate Vectorize index from memory, restrict it to public starter questions, filter by topic/language/model/prompt-policy version, and require high similarity plus lexical guardrails before serving a semantic hit.
