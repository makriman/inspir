<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cloud Agent orientation

Canonical product repo: `makriman/inspir`. Live site: https://inspirlearning.com.

The deployed product is the branch `codex/free-static-no-games`. GitHub's default branch `main` is behind that branch and is not what production serves. Open pull requests against `codex/free-static-no-games`. Do not push to `main`, do not merge, and do not deploy unless the founder explicitly asks.

Read these first:

1. This file.
2. `docs/runtime-routes.md` for the live route map.
3. `wrangler.jsonc` and `cloudflare-worker.ts` for the Worker that actually runs.
4. `GET /api/health` on the live site. Trust that JSON over older docs. On 2026-09-23 it reported architecture `free-static-native-accounts`, `workerCpuPlan: free-10ms`, `openNext: false`, `games: false`, delivery `lean-api-worker`, version timestamp `2026-07-19T07:59:48.922226Z`.
5. `deploy.md` only for release invariants. It is an incident runbook. Do not run its production cutover, upload, activation, migration, or Wrangler commands.

Do not change these without an explicit founder instruction: billing and Stripe rails, subscription or payment copy, the Great Indian Company legal entity and GST text, schools pages and any schools outbound, the UK / inspir.uk entity and lander, `AUTH_SECRET` or cookie names, user ids, or a production deploy.

## House Rules

- Production is a Cloudflare Workers Free static site plus a narrow native Worker. Public documents are Workers Static Assets. `cloudflare-worker.ts` handles only the `assets.run_worker_first` API and chat-child allowlist. `wrangler.jsonc` points `main` at that file and serves assets from `.open-next/assets`.
- Next.js and OpenNext are build tools. They prerender documents. The deployed request handler must not import `next`, `next/server`, `.open-next/worker.js`, or `@opennextjs/cloudflare`. Do not turn the OpenNext server runtime, incremental cache, or cache queue back on unless the founder explicitly re-enables them.
- Workers Free CPU budget is 10 ms. `wrangler.jsonc` must not set `limits.cpu_ms`. Keep games absent. Avoid new request-time CPU: large JSON parsing, unbounded D1 scans, embedding calls, Vectorize queries, and stream reassembly on the user request path.
- Live bindings are D1 (`DB`), Vectorize (`MEMORY_VECTORIZE`), profile-image R2 (`PROFILE_IMAGES_R2_BUCKET`), and the memory post-turn Queue plus its DLQ. The daily cron is `0 3 * * *`. `DOQueueHandler` / `NEXT_CACHE_DO_QUEUE` is a dormant migration tombstone. Do not send it traffic.
- `lib/free-runtime/` is the production API. Files under `app/api/` are the Next dev/build surface. They are not the live request path. A local `pnpm dev` check does not prove production behavior.
- Do not reintroduce Bubble, Vercel, Supabase, Neon, Postgres, or pgvector runtime assumptions. Historical migrations and lockfile optional-peer metadata are the only acceptable references.
- Preserve strict TypeScript. Do not add `any`, `@ts-ignore`, unsafe casts, or untyped route payloads when a local type/schema can express the contract.
- API routes must self-enforce authorization. Middleware and Static Assets are not an authorization boundary. Private data access must be scoped by the authenticated user in the handler or query.
- Global LLM budget is a spend ceiling and must fail closed. Per-user or per-guest limits may fail open only when the code intentionally favors availability and logs the failure.
- Guest chat must not trust client-resettable state as the only quota key. Keep server-derived session, fingerprint, and IP buckets and bounded request history. Production guest identity uses Cloudflare `cf-connecting-ip` only. Do not accept `x-forwarded-for` on the production handler.
- Chat streaming is a user-facing quality gate. Authenticated provider bytes pass through without Worker-side token parsing. Avoid remounting streamed assistant messages, raw markdown flashes, scroll jumps, and MutationObserver work on token chunks.
- Translations are supplied by curated bundles. Prefer render-time lookup for new UI copy. Do not expand DOM-walking translation.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before committing. CI on pull requests currently runs React Doctor only (`.github/workflows/ci.yml`); that does not replace the local gates. For deployable runtime changes, also run the Cloudflare gates in `deploy.md`, and only when the founder has asked for a release.
- Never commit local backups, generated Cloudflare reports, build artifacts, `.env*` secrets, `.dev.vars`, `.next`, or `.open-next`.
