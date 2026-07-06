# Expert Review Follow-Ups

This file records recommendations from the external review that are not direct code changes in the current hardening batch.

## Authentication Runtime

Status: migrated to Better Auth, with sliding session refresh restored.

The app now uses Better Auth with Google OAuth, D1-backed session rows, and Cloudflare Worker runtime configuration. The migration keeps the existing `users`, `accounts`, `sessions`, and `verification_tokens` table names so user IDs and app data survive the auth-library change.

Follow-up discipline:

- Keep the auth route, middleware, admin, private chat, and session-auth E2E tests passing.
- Re-check Better Auth release notes before future auth upgrades.
- Treat any future auth-table schema change as its own deployable project with production Google sign-in and session regression tests.
- `requireSession()` refreshes sessions by default so normal app activity honors the Better Auth one-day `updateAge`; telemetry-only reads must opt out with `{ refresh: false }`.
- `requireLocalEmailVerified: false` is intentionally safe only while Google is the sole provider and Google `email_verified` is enforced. Revisit before adding any second provider.
- Keep the legacy NextAuth columns on `accounts` through the soak period as rollback data, then drop them in one table-focused migration.

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

Status: nonce-based script CSP implemented through middleware.

Middleware generates a per-request nonce, forwards it in `Content-Security-Policy` and `x-inspir-csp-nonce`, and layout scripts receive the same nonce. Production `script-src` no longer uses `unsafe-inline` or `unsafe-eval`; development keeps `unsafe-eval` only when `NODE_ENV=development`.
