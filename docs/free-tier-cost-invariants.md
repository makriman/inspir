# Workers Free cost invariants

Production stays on the Workers Free 10 ms CPU ceiling. `wrangler.jsonc` has no `limits.cpu_ms`. Deploy preflight fails closed when the bindings below become more expensive than these pins. The native cron handlers read the same ceilings from `lib/free-runtime/free-tier-cost-limits.ts`.

These pins are draft deploy guards. Shipping them is a review step, separate from a production release.

## Memory queue

`inspirlearning-memory-post-turn-prod` is the only queue producer and consumer.

- `max_batch_size` is `1`, so one invocation cannot multiply memory work past 10 ms.
- `max_batch_timeout` is an integer from 1 through 10 seconds.
- `max_retries` is an integer from 1 through 5.
- `retry_delay` is an integer of at least 60 seconds.
- The dead-letter queue stays `inspirlearning-memory-post-turn-dlq`.
- Extra consumer keys, including `max_concurrency`, fail preflight.

## Scheduled work

The daily cron `0 3 * * *` and `GET /api/cron/memory-dreaming` share these ceilings:

- Synthesis enqueue: 25 users (`NATIVE_SCHEDULED_MEMORY_USER_CAP`)
- Rate-limit prune: 5,000 rows (`MAX_RATE_LIMIT_PRUNE_ROWS`)
- Stale AI run fail: 500 rows (`MAX_STALE_AI_RUN_REPAIRS`)

Preflight reads those exports from `lib/free-runtime/state-api.ts` and fails if they stop aliasing the shared ceilings, or if the SQL limits and synthesis `Math.min` stop using them. Raising the shared numbers also fails the pinned copy in `scripts/cloudflare/deploy-preflight.ts`.

## Retired cache

The OpenNext incremental-cache bucket `inspirlearning-next-cache-prod` stays unbound. Binding names `NEXT_INC_CACHE_R2_BUCKET` and `NEXT_CACHE_R2_BUCKET` fail preflight. The only R2 binding is profile images.

`NEXT_CACHE_DO_QUEUE` / `DOQueueHandler` remains a dormant migration tombstone: one binding, no `script_name`, and the `opennext-cache-queue-v1` migration still names that single SQLite class. Removing the binding is a Durable Object migration event. Cache queue producers or consumers fail preflight.

## Observability

Outside `OBSERVABILITY_INCIDENT_MODE=1`, head sample rates cannot exceed the committed steady-state values: worker `0.02`, logs `0.05`, traces `0.02`. Incident mode may raise each rate up to `1`.

## Request-path vectors

Request-path Vectorize queries stay with draft PR #12: `MEMORY_REQUEST_VECTOR_QUERY=0` in Wrangler, and a preflight reject when that var is anything else. Keep the runtime vector-off when the var is missing. This guard leaves that check to #12.
