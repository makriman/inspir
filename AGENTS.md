<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## House Rules

- Production runs on Cloudflare Workers via OpenNext. Keep runtime code Cloudflare-first: D1 for relational data, Vectorize for memory search, R2 for object/cache storage, Queues for background memory work, and Wrangler for deploy evidence.
- Do not reintroduce Bubble, Vercel, Supabase, Neon, Postgres, or pgvector runtime assumptions. Historical migrations and lockfile optional-peer metadata are the only acceptable references.
- Preserve strict TypeScript. Do not add `any`, `@ts-ignore`, unsafe casts, or untyped route payloads when a local type/schema can express the contract.
- API routes must self-enforce authorization. Middleware/proxy is only an optimistic UX guard; private data access must be scoped by the authenticated user in the route or query.
- Global LLM budget is a spend ceiling and must fail closed. Per-user or per-guest limits may fail open only when the code intentionally favors availability and logs the failure.
- Guest chat must not trust client-resettable state as the only quota key. Keep server-derived buckets and bounded request history.
- Chat streaming is a user-facing quality gate. Avoid remounting streamed assistant messages, raw markdown flashes, scroll jumps, and MutationObserver work on token chunks.
- Translations are supplied by curated bundles/DB tables. Prefer render-time lookup for new UI copy; avoid expanding DOM-walking translation.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before committing. For deployable runtime changes, also run the Cloudflare gates in `deploy.md`.
- Never commit local backups, generated Cloudflare reports, build artifacts, `.env*` secrets, `.dev.vars`, `.next`, or `.open-next`.
