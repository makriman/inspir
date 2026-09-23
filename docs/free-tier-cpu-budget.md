# Workers Free CPU budget

Production stays on Cloudflare Workers Free. Each invocation has a 10 ms CPU ceiling. `wrangler.jsonc` must not set `limits.cpu_ms`. During the 2026-07-09 outage, Cloudflare rejected a paid CPU allowance on this account (API code `100328`). Do not add a paid plan or a higher CPU limit to make a slow path fit.

## What already failed

`docs/incidents/2026-07-09-worker-resource-outage.md` records `Exceeded CPU Limit` on the shared OpenNext Worker for chat, sign-in, and prompts. Games were an activator, not the only cause. The product decision was to stay on Workers Free and remove the OpenNext request runtime.

Do not deploy `.open-next/worker.js`. That file is the OpenNext server worker. Wrangler `main` is `./cloudflare-worker.ts`. `.open-next/assets` is the Static Assets directory and is not the request handler. Deploy preflight already rejects an OpenNext request-runtime import in the native Worker (`scripts/cloudflare/deploy-preflight.ts`).

## Memory work still on the user request

Authenticated chat in `lib/free-runtime/protected-ai-api.ts` can still retrieve memory before the tutor response: D1 reads, an embedding call, and Vectorize queries in `lib/free-runtime/native-memory-vector.ts`. Waiting on fetch is not CPU. Parsing the embedding body, the D1 rows, and the prompt still counts toward 10 ms. A memory-enabled signed-in turn can also spend a second global LLM call on the embedding before the chat completion.

The 2026-09-23 review ranks this as the request-path risk that can take the live tutor down without a bad deploy. That review is draft pull request https://github.com/makriman/inspir/pull/10, branch `cursor/free-static-agent-review-2578`, file `docs/cloud-agent-review-2026-09-23.md`. It is not on this branch until that draft lands.

The request-path guard is a separate change. This note does not move embeddings, change Vectorize queries, or edit `protected-ai-api.ts`. As of 2026-09-23 the sibling Cloud Agent for that guard is https://cursor.com/agents/bc-c9191bd2-6937-5bc3-9981-406f531ff609 and had not published a GitHub pull request. Do not reimplement that guard here.

## Agent and dev traps

| Surface | What it is |
| --- | --- |
| `lib/free-runtime/` and `cloudflare-worker.ts` | Production API and Worker entry |
| `app/api/*` | Next handlers. `pnpm dev` serves them. Production does not |
| `app/api/health/route.ts` | Next health. `deploymentMode: free-static-first`, `incrementalCache: regional-r2`. Not live health |
| `healthResponse` in `cloudflare-worker.ts` | Live `/api/health`. `free-static-native-accounts`, `openNext: false`, `incrementalCache: none`, `workerCpuPlan: free-10ms` |
| `.open-next/worker.js` | Do not deploy |
| `.open-next/assets` | Materialized static output. Wrangler serves this directory |

A green `pnpm dev` session does not prove production behavior. Change live routes in `lib/free-runtime/` and cover them with tests there. Trust live `GET https://inspirlearning.com/api/health` over the Next health route.
