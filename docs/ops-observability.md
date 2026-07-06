# Ops Observability

The admin dashboard reads first-party telemetry from D1:

- `ai_runs`: daily runs, tokens, failures, and model usage.
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
