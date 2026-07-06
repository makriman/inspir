# Expert Review Follow-Ups

This file records recommendations from the external review that are not direct code changes in the current hardening batch.

## Auth.js v5

Status: defer until stable release.

The review recommended moving from `next-auth` v4 because the reviewed snapshot believed v4 did not support Next 16. Re-checked on 2026-07-06: `next-auth@4.24.14` is still the `latest` dist tag, advertises peer support for Next 16 and React 19, and the v5 line is still published under the `beta` dist tag. The experimental `@auth/nextjs` package is not a stable replacement path either. Production auth should not move to a beta or experimental package as part of a broad hardening pass.

Before revisiting:

- Keep the auth route, middleware, admin, private chat, and session-auth E2E tests passing.
- Re-check package metadata and official Auth.js migration notes.
- Treat the migration as its own deployable project with production Google sign-in and session regression tests.

## Render-Time I18n

Status: planned as a separate migration.

The review correctly identified DOM-walking translation as structural debt. The current app has already reduced the highest-risk part: rich chat message rendering uses `data-no-auto-translate`, and the observer now ignores mutations that occur inside no-translate subtrees, so token streaming does not trigger whole-tree translation rescans.

The long-term migration should still move UI copy to render-time `t()` lookups:

- Introduce a chat translation context over the existing `MainAppTranslationBundle`.
- Convert new chat UI copy to `t(source)` immediately.
- Convert existing components by slice, starting with stable chat controls and panels.
- Delete `useAutoTranslate` only after all chat UI strings render through the context.
- Keep DB-backed translation tables and import/export tooling as the translation supply chain.

This migration should include visual regression coverage for localized chat, RTL layout, and streaming markdown.
