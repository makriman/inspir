<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Non-production surfaces

Production API code is `lib/free-runtime/`, entered from `cloudflare-worker.ts`. `wrangler.jsonc` sets `main` to `./cloudflare-worker.ts`. Public documents are Workers Static Assets. Next.js and OpenNext are build tools.

- `app/api/*` is the Next.js dev and build surface. It is not the live request path. Change a live route in `lib/free-runtime/` and dispatch it from `cloudflare-worker.ts`.
- `pnpm dev` (`next dev`) serves those Next handlers on localhost. A passing `pnpm dev` check does not prove production behavior. Production parity is `pnpm cf:preview`, which runs the native Worker.
- Do not deploy `.open-next/worker.js`. Do not point Wrangler `main` at that file, and do not import it from `cloudflare-worker.ts`. It is the OpenNext server worker. Deploying it restores the request runtime that exceeded the Workers Free 10 ms CPU ceiling on 2026-07-09. `.open-next/assets` is static output only. See `docs/free-tier-cpu-budget.md` and `docs/incidents/2026-07-09-worker-resource-outage.md`.
- Live `GET /api/health` is `healthResponse` in `cloudflare-worker.ts`: `deploymentMode` `free-static-native-accounts`, `openNext: false`, `incrementalCache: none`, `workerCpuPlan: free-10ms`. `app/api/health/route.ts` is the Next probe (`free-static-first`, `incrementalCache: regional-r2`). Do not treat the Next JSON as live health.

## House Rules

- Production is the Cloudflare Workers Free static site plus the native Worker above. Keep runtime code Cloudflare-first: D1 for relational data, Vectorize for memory search, R2 for profile objects, Queues for background memory work, and Wrangler for deploy evidence. The deployed request handler must not import `next`, `next/server`, `.open-next/worker.js`, or `@opennextjs/cloudflare`.
- Do not reintroduce Bubble, Vercel, Supabase, Neon, Postgres, or pgvector runtime assumptions. Historical migrations and lockfile optional-peer metadata are the only acceptable references.
- Preserve strict TypeScript. Do not add `any`, `@ts-ignore`, unsafe casts, or untyped route payloads when a local type/schema can express the contract.
- API routes must self-enforce authorization. Middleware/proxy is only an optimistic UX guard; private data access must be scoped by the authenticated user in the route or query.
- Global LLM budget is a spend ceiling and must fail closed. Per-user or per-guest limits may fail open only when the code intentionally favors availability and logs the failure.
- Guest chat must not trust client-resettable state as the only quota key. Keep server-derived buckets and bounded request history.
- Chat streaming is a user-facing quality gate. Avoid remounting streamed assistant messages, raw markdown flashes, scroll jumps, and MutationObserver work on token chunks.
- Translations are supplied by curated bundles/DB tables. Prefer render-time lookup for new UI copy; avoid expanding DOM-walking translation.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before committing. For deployable runtime changes, also run the Cloudflare gates in `deploy.md`.
- Never commit local backups, generated Cloudflare reports, build artifacts, `.env*` secrets, `.dev.vars`, `.next`, or `.open-next`.
