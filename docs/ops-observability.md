# Ops Observability

The admin dashboard reads first-party telemetry from D1:

- `ai_runs`: daily runs, tokens, failures, and model usage.
- `ai_response_cache`: active/stale guest starter cache entries, cache hits, and estimated saved tokens.
- `product_events`: page views, auth error redirects, profile opens, and chat sends.
- `ops_events`: auth route status, admin changes, quota denials, and limiter failures.
- `llm_usage_daily_shards`: global LLM budget calls by UTC day.

Cloudflare Workers Logs should also alert on the fail-open/fail-closed lines emitted by the Worker:

- `rate_limit_check_failed`
- `llm_budget_check_failed`

Recommended Cloudflare notification rule:

- Product: Workers Logs
- Worker: `inspirlearning`
- Filter: `message contains "rate_limit_check_failed" OR message contains "llm_budget_check_failed"`
- Notification: owner email or operational destination
- Severity: high

The dashboard is the quick product/admin view; the Cloudflare rule is the pager-grade signal when D1 checks fail before an admin happens to open the app.

## AI Response Cache Signals

The guest/public starter response cache records cache outcomes as product events:

- `ai_cache_hit`
- `ai_cache_miss`
- `ai_cache_store`
- `ai_cache_bypass`
- `ai_cache_reject`

The admin dashboard surfaces hit/miss/store/bypass counts, active and stale entries, top cached topics, and estimated saved prompt/completion tokens. Cache failures are ops events under `ai_cache_read_failed`, `ai_cache_hit_record_failed`, and `ai_cache_store_failed`.

Cache hits are expected to keep normal guest quota headers while returning `x-inspir-cache: hit`. They should not increase `llm_usage_daily_shards`, because they return before the global LLM budget is consumed.
