# Cloud Agent review — 2026-09-23

Review of the live branch `codex/free-static-no-games` at `04105cdc` ("Keep CI to React Doctor"). No production deploy was performed. Nothing in this review was merged.

## How this was checked

- Source: `cloudflare-worker.ts`, `wrangler.jsonc`, `lib/free-runtime/*`, `app/api/*`, `public/_headers`, `middleware.ts`, `open-next.config.ts`, `deploy.md`, `docs/runtime-routes.md`, `docs/incidents/2026-07-09-worker-resource-outage.md`, `.github/workflows/ci.yml`.
- Live probes on 2026-09-23, unauthenticated:
  - `GET https://inspirlearning.com/api/health` → `200`, `x-inspir-delivery: lean-api-worker`, architecture `free-static-native-accounts`, `workerCpuPlan: free-10ms`, `openNext: false`, `games: false`, `incrementalCache: none`, `cacheQueueActive: false`, `memoryQueueActive: true`. Version id `d407b637-ab90-4eed-8a8e-11d5dece55d9`, timestamp `2026-07-19T07:59:48.922226Z`.
  - `POST /api/migration/e2e-auth` → `404` with an empty body (the handler's hidden response when E2E secrets are absent).
  - `GET /games` → `404`.
  - `GET https://www.inspirlearning.com/` → `308` to `https://inspirlearning.com/` with `x-inspir-delivery: www-redirect-worker`.

## What is in good shape

- The Worker entry is `cloudflare-worker.ts`. Public HTML bypasses it except for the exact `assets.run_worker_first` allowlist. `!/_next/static/*` stays first so chat globs cannot steal immutable chunks.
- Native session checks verify the HMAC-signed Better Auth cookie, load an unexpired D1 session, and admin checks add the DB/bootstrap allowlist. OAuth callback URLs are origin-checked. Guest chat on the native path refuses to run without `cf-connecting-ip` and does not honor `x-forwarded-for` except on localhost.
- Global LLM admission fails closed in `lib/free-runtime/guest-chat.ts`, `lib/free-runtime/protected-ai-api.ts`, and `lib/free-runtime/native-memory-vector.ts`. Authenticated tutor SSE is passed through; persistence is a separate ownership-checked finalize.
- Games are gone from the route surface. The dormant `DOQueueHandler` returns `410` and is documented as a migration tombstone.
- Secrets required by Wrangler (`CLOUDFLARE_AI_GATEWAY_TOKEN`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ADMIN_EMAILS`, `CRON_SECRET`) are names only. The committed Wrangler vars do not contain those values.

No P0 issue was confirmed on the live Worker from this pass. The items below are residual risks and agent traps, not a license to refactor.

## P1

### 1. Authenticated chat still does memory retrieval inside the 10 ms CPU budget

`handleAuthenticatedChat` in `lib/free-runtime/protected-ai-api.ts` admits the user quota and the global LLM ceiling, writes the user message, then calls `loadNativeMemoryPromptContext`. When retrieval is enabled, that function batches D1 reads and may call `queryNativeMemoryVectorIds` (`lib/free-runtime/native-memory-vector.ts`), which:

- reserves a second global LLM shard (`reserveGlobalProviderCall`, reason `memory_vector_query`) before the chat completion;
- requests an embedding and runs two Vectorize queries (`user_memories` and `chat_memory_turns`, `topK: 20`);
- hydrates matches with another D1 batch.

Waiting on fetch is not CPU, but parsing the embedding body (cap 256 KiB), the D1 rows, and the prompt still count toward the Free plan's 10 ms. `wrangler.jsonc` correctly has no `limits.cpu_ms`. The 2026-07-09 incident (`docs/incidents/2026-07-09-worker-resource-outage.md`) was an `Exceeded CPU Limit` outage on this same Free plan, including chat and sign-in.

A memory-enabled signed-in turn can also spend two daily global calls (embedding query plus chat). Vector writes spend a third call later on the queue.

Next action: sample production tail CPU for `/api/chat` with memory retrieval on, before adding any work to that path. If samples approach 8 ms, move the embedding and Vectorize query off the user request. Do not raise CPU limits on this account; Workers Free rejects `limits.cpu_ms`.

### 2. Two stacks still exist, and the Next one is unsafe to treat as production

`pnpm dev` serves `app/api/*`. Production does not. `assets.run_worker_first` sends those paths to `lib/free-runtime/`.

Concrete drift:

| Surface | Production (`lib/free-runtime`) | Next route still in the tree |
| --- | --- | --- |
| Health | `free-static-native-accounts`, `openNext: false`, `incrementalCache: none` in `cloudflare-worker.ts` | `app/api/health/route.ts` still imports `@opennextjs/cloudflare` and reports `free-static-first` plus `incrementalCache: regional-r2` |
| Guest chat | `cf-connecting-ip` only; forwarded headers only on localhost | `lib/guest-chat/safety.ts` `requestIpFromHeaders` falls through to `x-forwarded-for` and `x-real-ip` |
| Guest implementation | Native fetch, bounded SSE pass-through | `app/api/guest-chat/route.ts` still uses the AI SDK, response cache, and `next/headers` |
| Cron | Native bearer check, bounded enqueue, no inline LLM | `app/api/cron/memory-dreaming/route.ts` still calls `enqueueDueMemorySynthesis` from `lib/ai/memory-queue` via OpenNext context |
| Cache config | Live health: cache queue inactive, incremental cache none | `open-next.config.ts` still enables regional R2 incremental cache, the DO queue, and `enableCacheInterception: true` |

`wrangler.jsonc` `main` is `./cloudflare-worker.ts`, and deploy preflight checks that. Re-pointing deploy at `.open-next/worker.js` would bring back the July CPU failure mode. Agents that "fix" `app/api/health/route.ts` or `app/api/guest-chat/route.ts` and then verify with `pnpm dev` will not have changed production.

Next action: when editing a live route, change `lib/free-runtime/` and add a test there. Leave the Next handlers in place until the founder wants a deletion pass. Do not deploy an OpenNext server worker.

### 3. Default branch, security policy, and CI do not describe the live app

- `SECURITY.md` previously said security fixes target `main`. This PR points it at `codex/free-static-no-games`.
- `.github/workflows/ci.yml` runs `pnpm doctor:json` only. Push CI is limited to `main`. Pull requests against the live branch do get that job, and it does not run `pnpm typecheck`, `pnpm lint`, or `pnpm test`.
- `deploy.md` is the operational source of truth and also a one-release incident procedure (`0016` fresh trust boundary, paid-expedited cutover, production D1). An agent that follows those commands will mutate production.

Next action: treat `deploy.md` as read-only unless the founder asks for a release. Keep running the local typecheck, lint, and unit gates even though CI does not.

## P2

### 4. Production CSP is the static `unsafe-inline` policy, not the middleware nonce

`public/_headers` sets `script-src 'self' 'unsafe-inline' ...` on `/*`. That file is what Workers Static Assets send, including `/chat`. `middleware.ts` still builds a per-request nonce CSP (`lib/security/headers.ts`), and `docs/expert-review-followups.md` still says nonce CSP is implemented through middleware. Middleware does not run on Static Assets.

No `dangerouslySetInnerHTML` or `rehype-raw` usage showed up in a repo search, so this is a missing defense, not a confirmed XSS. Chat markdown is the sensitive surface if a renderer ever allows raw HTML.

Next action: do not assume middleware CSP protects production HTML. A future change should hash or nonce the static inline scripts and drop `unsafe-inline` from `script-src` without breaking GA, Clarity, or the chat shell.

### 5. Guest and memory quotas fail open on storage errors; the guest session cookie is unsigned

This matches the written availability rule, and it is still the main abuse window:

- `consumeGuestAdmission` in `lib/free-runtime/guest-chat.ts` logs `posture: fail_open` when the D1 batch throws, then admits the guest if a separate global-budget write succeeds. The unsigned `inspir_guest_session` cookie is only a display fallback in that path. While D1 is healthy, session, fingerprint, and IP keys are server-derived. While D1 is failing, per-guest caps do not apply.
- Fingerprint material is IP plus coarse user-agent, accept-language, and `sec-ch-ua-platform` (`guestFingerprintHash`). Rotating the user-agent changes the fingerprint. The IP bucket (`RATE_LIMIT_GUEST_IP_DAILY` = 150) is the real cap, which is shared by NAT and school networks.
- `consumeAiAdmission` fail-opens the per-user quota and still fail-closes the global ceiling.
- `consumeMemoryQuota` in `lib/free-runtime/state-api.ts` fail-opens memory mutations with no global-budget check on that path. Embedding calls later still reserve a global call when they run.

Next action: leave the posture as-is unless the founder wants guest chat to fail closed during D1 errors. Do not make the client cookie the only key.

### 6. The migration E2E route stays on the public Worker allowlist

`/api/migration/e2e-auth` is in `assets.run_worker_first` and is dispatched from `handleAccountApiRequest`. `handleMigrationE2EAuthRequest` returns `404` unless `E2E_TEST_AUTH_SECRET` and `E2E_TEST_AUTH_EMAIL` are set, then can mint a session for that email. The live probe returned `404`, so those secrets were not active at review time.

Next action: after every release validation, confirm the five temporary validation secrets are absent and this route still returns `404`. Do not remove the route in a drive-by; cleanup is part of the release wrapper.

### 7. Bootstrap admin email is compiled into the Worker

`lib/free-runtime/native-session.ts` treats `makridroid@gmail.com` as an admin even when `ADMIN_EMAILS` does not list it, and also checks `admin_users` plus `ADMIN_EMAILS`. That is a founder break-glass, not a secret.

Next action: do not delete it without the founder. Anyone who can sign in as that Google account is an admin.

### 8. Free-plan bindings that are easy to make expensive

From `wrangler.jsonc` and the live health JSON:

- D1 database `inspirlearning-prod`.
- Vectorize index `inspirlearning-memory-prod` (query on the chat path, upsert on the memory queue).
- R2 bucket `inspirlearning-profile-images-prod` only. The old OpenNext cache bucket is not bound.
- Queue `inspirlearning-memory-post-turn-prod`, `max_batch_size: 1`, DLQ, 5 retries. The batch size of 1 is intentional so one invocation cannot multiply memory work past 10 ms.
- Cron `0 3 * * *` runs vector-cleanup drain, synthesis enqueue (cap 25 users), and `waitUntil` work that prunes up to 5,000 rate-limit rows, refreshes admin totals, and fails up to 500 stale AI runs (`lib/free-runtime/state-api.ts`). Cron CPU is the same Free 10 ms ceiling.
- Dormant Durable Object class `DOQueueHandler`. Removing the binding is a migration event, not a cleanup commit.
- Observability is enabled at low head sample rates (logs 0.05, traces 0.02).

Profile upload (`lib/profile/photo.ts`, `putProfilePhoto`) hashes up to 1 MB on the request path after `formData()` parsing. That is authenticated and size-capped, and it is still a Free CPU spike.

Next action: do not increase queue batch size, cron caps, or request-path embedding work. Do not bind the retired cache R2 bucket.

### 9. Docs that will mislead the next agent

- `docs/expert-review-followups.md` still describes middleware CSP and a NextAuth soak. Production auth is the native Google handler in `lib/free-runtime/account-api.ts`.
- `docs/runtime-routes.md` matches the Worker and is the doc to trust.
- `deploy.md` mixes steady-state invariants with the expired-key `0016` incident. The top of the file is accurate; the cutover commands are not a default agent task.
- `README.md` already describes static-first native delivery. Root `AGENTS.md` did not, until this PR.

### 10. Maintainability

`lib/free-runtime/state-api.ts`, `account-api.ts`, and `protected-ai-api.ts` are each several thousand lines. Behavior is covered by large unit tests under `tests/`. A drive-by split will churn those tests and risk the Free CPU contracts. Prefer a finding and a focused change over a file move.

`RATE_LIMIT_MEMORY_DAILY` is `"20"` in `wrangler.jsonc` and the code fallback in `consumeMemoryQuota` is `60` if the var is missing. Production uses the Wrangler value.

## P3

- `lib/free-runtime/timing-safe-equal.ts` returns false when `crypto.subtle.timingSafeEqual` is missing. On the Workers compatibility date `2026-07-08` the method exists, so this fails closed rather than falling open. Do not replace it with a JS XOR loop on the production path.
- `SECURITY.md` reporting instructions are fine. Keep vulnerability reports private.
- Committed `account_id` and the AI Gateway account path in `wrangler.jsonc` identify the Cloudflare account. They are not API tokens. Do not copy tokens into vars.

## Surfaces deliberately not changed

- Billing, subscription, and Great Indian Company GST language in `lib/content/extracted-pages.ts` and the translation packs.
- Schools routes and schools copy (`app` marketing pages, sitemap seeds, translation namespaces `route:schools`).
- inspir.uk strings in curated mission packs.
- Runtime handlers, Wrangler bindings, migrations, and deploy scripts.

## Recommended order of work

1. Keep this findings PR unmerged until the founder accepts the house-rule text.
2. Confirm with a tail sample that memory-on `/api/chat` stays under 8 ms CPU. That is the only P1 that can take the live tutor down without a code mistake.
3. If a code change is authorized later, make the Next `app/api` handlers obviously non-production (or delete them) only with tests that the native Worker still owns every `run_worker_first` path.
4. Plan a static CSP tighten separately. Do not ship it as a side effect of another change.
5. Do not run `pnpm cf:deploy`, `pnpm cf:upload`, or the `0016` cutover scripts from an agent session.
