# Expert Review Follow-Ups

This file records recommendations from the external review. Production is the native Worker: `cloudflare-worker.ts` and `lib/free-runtime/`. Next middleware, NextAuth, and `app/api/*` are not the live request path.

## Authentication

Status: native Google sign-in in `lib/free-runtime/account-api.ts`.

`handleAccountApiRequest` owns `/api/auth/*`, `/api/logout`, and `/api/me`. Google OAuth completes in `handleNativeGoogleCallback` (`/api/auth/callback/google`), which checks the Google identity token and writes a D1 session. Later requests use the HMAC-signed cookie through `requireNativeSession` in `lib/free-runtime/native-session.ts`.

That is the production auth contract. Do not treat a NextAuth soak, leftover NextAuth columns, or `requireSession()` refresh as live behavior. `middleware.ts` does not run for Workers Static Assets. Google remains the only identity provider. A future auth-table change is its own deployable project, with production Google sign-in and session regression tests, and is not a reason to restore NextAuth.

## Render-Time I18n

Status: in progress by slice.

The review correctly identified DOM-walking translation as structural debt. The current app has already reduced the highest-risk part: rich chat message rendering uses `data-no-auto-translate`, and the observer now ignores mutations that occur inside no-translate subtrees, so token streaming does not trigger whole-tree translation rescans.

The long-term migration should still move UI copy to render-time `t()` lookups:

- Introduce a chat translation context over the existing `MainAppTranslationBundle`.
- Convert new chat UI copy to `t(source)` immediately.
- Convert existing components by slice, starting with stable chat controls and panels.
- Delete `useAutoTranslate` only after all chat UI strings render through the context.
- Keep DB-backed translation tables and import/export tooling as the translation supply chain.

This migration should include visual regression coverage for localized chat, RTL layout, and streaming markdown.

Current commitment:

- New profile/admin-entry UI copy in chat uses the existing render-time `t()` translator.
- Profile, memory, and age-prompt slices already render through `t()` and should stay that way.

## CSP

Status: Workers Static Assets `public/_headers` is the production CSP.

`public/_headers` sets `Content-Security-Policy` on `/*`, including `/chat`. The live `script-src` is `'self' 'unsafe-inline'` plus the Google, Tag Manager, and Clarity hosts. That is the policy browsers receive for static HTML.

`middleware.ts` and `lib/security/headers.ts` still build a per-request nonce policy (`Content-Security-Policy` and `x-inspir-csp-nonce`). Static Asset matches bypass Next middleware, so that nonce policy is not production HTML protection. Do not describe it as the live CSP, and do not rewrite `script-src` as a side effect of another change.

## Post-release hidden auth check

`/api/migration/e2e-auth` stays on the Worker allowlist. `handleMigrationE2EAuthRequest` in `lib/free-runtime/account-api.ts` returns `404` with an empty body when `E2E_TEST_AUTH_SECRET` or `E2E_TEST_AUTH_EMAIL` is unset. After every release validation, confirm those temporary secrets are absent and `POST /api/migration/e2e-auth` still returns `404`. Do not remove the route in a drive-by. See `docs/runtime-routes.md`.
