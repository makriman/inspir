# Language translation work

Last updated: 17 July 2026

## Release decision

For the stable pre-games InspirLearning release, translation scope is accepted at the current staged major-language/static coverage with English fallback for remaining long-tail gaps.

This release must not wait for the full 8,556-row multilingual completion target. The full completion gate remains intentionally useful for the next translation run, but it is not a launch blocker for this release.

## Completed and preserved

- Static main-app translation bundles are tracked and covered by tests, including account, memory, activity, recovery, chat shell, quiz, flashcard, saved result, and route-facing copy.
- Reviewed semantic repairs are preserved for the audited high-risk languages and strings, including Arabic, Hindi, Spanish, Dutch, Assamese, Marathi, Gujarati, Thai, Punjabi, and Odia coverage exercised by the translation quality tests.
- The staged fallback release path is pinned to the current accepted coverage:
  - 668 unique staged rows accepted for this release.
  - 599 site/curated rows.
  - 69 main-app rows.
- English fallback remains the intended behavior for unsupported, missing, deferred, or stale long-tail translation rows.
- Translation DB reconciliation is guarded: uploaded-inactive verification is read-only, candidate-active cleanup is ordered after activation, and local authorization files do not grant production or deploy authority by themselves.
- The full test suite currently covers the staged release/fallback contract, static main-app bundles, semantic repair preservation, staged D1 reconciliation, and the intentionally red/full-completion distinction.

## Explicitly deferred

- Do not attempt the remaining full multilingual completion in this release goal.
- The long-tail completion work still needs a future run for the deferred rows:
  - 7,865 deferred missing rows from the current staged plan.
  - 92 deferred stale rows from the current staged plan.
- The full curated target remains 8,556 rows; the broader storage projection also accounts for marketing/main-app rows separately.
- The known full-completeness test should not be weakened. It should become green only when the future full translation run actually closes the remaining row gap.

## Future translation run checklist

1. Start from a clean, pushed branch and re-audit the dirty tree before staging anything.
2. Do not force-add ignored translation workbench, secret, temporary, or generated artifact directories.
3. Treat old translation salvage/smoke directories as evidence-specific:
   - The current accepted private r4 salvage root was candidate-generation-input-only.
   - Stale r3 and interrupted r5/r6-style smoke outputs must not be reused as promotion authority.
4. Generate remaining long-tail candidates in bounded batches with the pinned offline/semantic verifier path.
5. Run structural QA, semantic audit, duplicate-key checks, source-hash checks, and protected-literal checks before any D1 plan is considered promotable.
6. Prepare a fresh D1 translation delta only after the candidate packs are reviewed and provenance-bound.
7. Keep production writes behind the existing guarded Cloudflare scripts; do not run raw ad-hoc D1 migrations or manual SQL against production.
8. After promotion, rerun typecheck, lint, tests, OpenNext/Cloudflare gates, preview E2E, and production translation validation.

## Launch posture for this release

Shipping with current coverage plus English fallback is intentional. The product should remain multilingual for the covered major/static surfaces, preserve user/account/memory/admin functionality, and avoid the previous CPU/resource crashes. Long-tail translation completion is a follow-up project, not part of this release cutover.
