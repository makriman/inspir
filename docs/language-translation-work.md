# Language Translation Work

## Release decision

On 15 July 2026, the release scope was narrowed to ship the stable, no-games
InspirLearning product without waiting for every long-tail marketing page to be
translated. Two isolated Afrikaans candidate runs were allowed to finish, but
each failed closed at 119 of 121 packs on a different shared fluency edge. No
Afrikaans candidate pack is promoted in this release. Existing source-current
translations remain available, including the complete 1,878-string Afrikaans
main-app bundle and the already-curated Afrikaans site routes. Every incomplete
or quality-stale site namespace uses the canonical English experience until a
later translation release completes it.

This is an explicit deferral, not a claim that the full multilingual corpus or
the Afrikaans site corpus is complete. It must not be implemented by accepting
partial packs, weakening field validation, publishing mixed-language pages, or
using the private R16/R17 candidates as release evidence.

## Current checkpoint

Status at the time this document was created:

- English remains the canonical source language.
- All 69 tracked non-English main-app bundles are complete and pass the current
  structural and fluency checks. These bundles cover account, authentication,
  saved-chat, memory, admin, learning-mode, quiz, flashcard, result, profile,
  and general workspace copy. The current check validates 1,878 strings per
  language against source hash
  `fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0`.
- The tracked site tree currently contains 691 physical non-English packs.
  Current planning classifies 599 as reusable and 92 as source- or
  quality-stale replacement targets.
- Hindi, Spanish, Arabic, and Malayalam each have all 124 physical site packs,
  but their current clean counts are respectively 117, 67, 99, and 121. Their
  remaining 7, 57, 25, and 3 packs comprise all 92 stale replacement targets.
  The other supported languages have the smaller previously promoted baseline.
- The current full-corpus target remains 8,556 site packs: 124 site namespaces
  across 69 target languages. Including the 69 main-app bundles, the logical
  semantic-audit target is 8,625 packs.
- The full current-provenance generation plan contains 7,957 candidate jobs:
  7,865 missing site packs and 92 replacements for existing stale site paths.
- A historical pre-release checkpoint advertised 255 localized document
  entries. That old set has no current durable release artifact and is not
  release evidence. A fresh current-policy check rejected 10 identities, and
  the manifest has now been regenerated to the exact 245-entry clean set. The
  rejected identities use canonical English fallback for this release rather
  than being treated as translated coverage.
- No production read, write, migration, synchronization, deployment, or
  validation was authorized or recorded in this task.

The strict current-tree inventory reader reproduces these counts and binds the
691-pack curated site tree as
`e2adb0fe3b2de3dd89a62be44054c7b2960e598a8173c445bfcf8c8cafbded66`
and the 69-pack static main-app tree as
`005777f0ef2b76e93e3c145c07a7dcdb91fe7345669c69af9d5f8c3144149445`.
These current-tree facts are now the frozen translation target for this
fallback-only release. The distinct current-tree attestation has now been
generated and independently reread; its exact hashes are recorded below.
The latest code-tree Next/OpenNext builds, resource checks, scans, startup
check, and both Wrangler dry-runs pass. This document update changes the
repository fingerprint, so the final aggregate source-bound local gate must
rerun them after a credential-backed preview passes. Production E2E and release
rehearsal remain pending. No Afrikaans promotion hash is expected.

## Work completed

### Main-app translations

The compact deployment bundles in `translations/static-main-app/` cover all 69
target languages. Validation is source-hash exact and rejects missing keys,
unknown keys, source copies, placeholder drift, non-NFC text, and known fluency
failures. The source workbench is not a runtime dependency. Runtime delivery
uses these static bundles rather than issuing per-page translation D1 queries or
Worker-side translation fan-out.

### Site-source and availability architecture

Site copy is extracted into a tracked source manifest. A localized static route
is advertised only when every namespace required by that route has a complete,
source-current, fluent pack. The availability manifest is therefore a release
allowlist, not an assertion that every physical JSON file is safe.

Incomplete coverage follows the established English behavior:

- internal marketing links drop the locale and resolve to the canonical English
  URL when the requested language lacks complete coverage;
- unsupported localized static routes are not generated;
- the language picker and sitemap omit unavailable locale/route combinations;
- partial or stale bundles are never combined with English strings to create a
  mixed-language localized page;
- the main application continues to use its complete static language bundle.

The 10 identities rejected when the formerly over-advertised manifest was
revalidated are Hindi `route:blog`; Spanish
`route:for`, `route:blog`, `route:prompts`, `route:schools`, `route:subjects`,
and `route:topics`; and Arabic `route:blog`, `route:for`, and `route:topics`.
The current 245-entry manifest no longer advertises them and reports zero
invalid advertised namespaces. The release process must record that exact
complete set and hash rather than relying on this prose list. No non-Afrikaans
repair is in this release scope, so all 10 fall back to English.

### Generation and audit hardening

The local NLLB pipeline is offline, bounded, single-worker, and provenance
bound. It validates exact model, Worker, pipeline, source, seed, validator, and
execution-profile hashes. Candidate files are withheld on failed validation;
semantic audit and promotion remain separate gates.

Afrikaans rescue values are exact source/value/occurrence-bound generation
overrides. Forced and ordinary segments are separated into deterministic
cohorts, and every cohort composition is provenance-bound. Adding a reviewed
rescue can still change later ordinary-cohort offsets, so it retires the older
run instead of authorizing an in-place resume. Primary and retry decoding
require hard deterministic algorithms, warning-only mode off, and seed 0
immediately before every decode. Reviewed values are adopted before pack
validation and are excluded from retries and plaintext logs.

The core ninth-rescue and deterministic-cohort architecture is implemented and
has an independent clean review. Later scoped-release work changed the
generator and verifier bytes. That makes every earlier private candidate-input
acceptance implementation-stale; it does not require another Afrikaans run for
this fallback-only release. A future Afrikaans completion release must create
fresh candidate-input evidence against its then-frozen implementation.

The previous Afrikaans `r15` candidate run is retired and cannot be resumed or
promoted. It exited nonzero after 41 minutes 47 seconds with 119 of 121 candidate
packs; the two unresolved packs were the blog case-study prompts and blog route.
Its historical salvage acceptance is also stale because the bound generator and
verifier implementations changed. R12 was valid only as candidate input for
R16 and became stale when the tenth reviewed rescue changed the generator and
Worker implementations. R13 was valid only as candidate input for R17 and is
now implementation-stale after the final cycle cleanup. Its historical private
artifact was published at
`tmp/long-tail-translation-acceptance-v10-historical-r13`: directory mode
`0700`, exactly two owner-only mode-`0600` single-link files, accepted at
`2026-07-15T21:29:35.999Z`, and expiring at
`2026-07-22T21:29:35.999Z`. It granted candidate-generation input authority to
R17 only; it now grants no candidate-input, promotion, deployment, or
production authority and must not be reused. A fresh run and fresh private
acceptance are future-Afrikaans work, not a prerequisite for this release.

The fresh `r16` run used the R12 acceptance, one offline MPS worker, the pinned
model and execution profile, and no promotion flag. Its primary validation found
214 failing fields across 59 packs and reduced those failures through three
bounded retry rounds to one shared source affecting two fields in two packs.
The independent deterministic CPU/float32 terminal rescue also refused that
source for fluency. The run therefore exited nonzero after writing 119
restart-safe candidate packs and withheld `blog:ai-civics-coach-guide` and
`route:blog`. No audit, promotion, manifest regeneration, attestation, or
production action followed. A tenth exact reviewed rescue was required for source
`f20e1ae1b0659633731779b7e2a20b3f586d09b582c1f57160905cd6618e0e17`;
the reviewed value is now value-, occurrence-, validator-, and
provenance-bound and deliberately does not reuse the mechanically accepted but
poor historical Afrikaans wording. This implementation change retired both
R16 and R12; neither may be resumed, audited, or promoted.

The fresh `r17` run used the tenth-rescue implementation and then-current R13
acceptance. The Civics source was clean and the primary failure set decreased
from 214 fields/111 sources to 212 fields/110 sources exactly as expected. After
three bounded rounds, 109 retry sources were clean, but a different shared
Economics Simulator source remained fluency-invalid in two fields across
`blog:ai-economics-simulator-guide` and `route:blog`. Its deterministic
CPU/float32 terminal rescue also failed closed. R17 therefore exited nonzero
with 119 owner-only candidate files for 121 jobs and is not promotable. The
remaining source is
`ee3dc79a2de175d0f1ee9ad2d824022cd87f62192f8e060c69bf44c9d23e400d`.
No R17 audit, promotion, manifest regeneration, attestation, or production
action followed.

### Staged fallback release contract

The narrowed release has its own evidence type; it does not reuse or relabel the
full 8,625-pack semantic release. An Afrikaans-staged branch was implemented
for a successful 121-pack candidate cohort, but R16 and R17 never satisfied its
entry conditions and that branch is not selected for this release. The current
fallback-only branch must instead require:

- no candidate import, semantic-audit proof, promotion transaction, or
  post-promotion tree dependency from R16 or R17;
- a distinct tracked
  `translations/current-fallback-no-site-promotion-attestation.json` artifact
  that binds
  the exact source and availability manifests, curated and main-app trees,
  7,957-entry pending ledger, 245 localized paths, English-fallback policy, and
  non-authority flags;
- an exact availability-derived D1 corpus of 599 clean site rows plus all 69
  complete main-app rows, for 668 rows total; and
- current deploy preflight that accepts either a valid full semantic
  attestation or the distinct no-site-promotion fallback attestation while
  rejecting missing, mixed, stale, or tampered evidence. The completed-
  Afrikaans reader and schema remain future-use code, not an operative branch
  for this release.

The original staged architecture and its fail-closed proof reader remain useful
for a future completed Afrikaans run, but no real Afrikaans-staged artifact may
be created from the partial runs. The separate current fallback-only artifact
was generated only after the 668-row/245-path contract compiled and its focused
tests passed. It grants no deployment or production authority by itself.

## Afrikaans outcome

Afrikaans site generation is concluded without promotion for this release.
R16 and R17 each ran offline with one worker, hard determinism, bounded retries,
and no observed sockets. Each correctly withheld two packs rather than
accepting a shared fluency failure. The failures moved when the reviewed cohort
changed, so another override/run would shift later decode segments and risk
continuing the same loop.

The trusted release accounting therefore remains unchanged:

- 691 physical site packs;
- 599 clean site packs;
- 92 source- or quality-stale replacement targets;
- 7,957 deferred candidate jobs: 7,865 missing packs plus 92 stale
  replacements;
- 245 exact localized HTML paths; and
- 668 exact D1 translation rows: 599 clean site rows plus 69 complete main-app
  rows.

The existing Afrikaans availability entries remain limited to their already
complete current namespaces. Current generated localized assets are
`af/index.html`, `af/chat/index.html`, and `af/mission/index.html`; unavailable
Afrikaans site links resolve to canonical English. The complete Afrikaans
main-app bundle remains active for the application experience.

A future Afrikaans restart must use fresh implementation hashes and a fresh
candidate-input acceptance. It must generate all 121 candidates, pass the exact
125-pack/16,564-field semantic audit with zero failures, and complete immutable
promotion before any additional Afrikaans namespace or path is advertised.
R16, R17, R12, and R13 must not be reused as release or promotion evidence.

## Deferred translation work

The next translation release must resume from fresh current provenance and
complete the remaining 7,957 candidate jobs. It must not reuse a retired run,
an expired salvage acceptance, or an audit generated against older source,
validator, model, Worker, or pipeline hashes.

At the measured local throughput, the deferred generation is expected to need
roughly 45.8 hours of uninterrupted model runtime: 7,957 deferred jobs divided
by the 121-job Afrikaans cohort, multiplied by the `r15` wall time of 41 minutes
47 seconds. This excludes retries, semantic audit, and adjudication. The
estimate explains the scope cut; it is not completion evidence or a promise
that all locales will finish without adjudication.

Required work for that later release:

1. create a fresh full planning worklist and candidate-input-only salvage
   acceptance;
2. generate the remaining locales offline with one bounded local worker;
3. retain partial checkpoints only for same-provenance resume;
4. semantically audit the exact 69-language, 125-namespace logical corpus;
5. replace all 92 stale site targets and add all missing site packs atomically;
6. produce the full semantic release attestation for 8,625 logical packs;
7. prepare the separate legacy `marketing-site` delta only after the full
   8,556-site-pack promotion is complete; and
8. prepare, verify, and apply the exact D1 translation delta under the Workers
   Free write budget and production trust boundary.

`pnpm test:translations:full-completion` and its unchanged 8,556-pack target
remain the strict definition of translation completion. It intentionally stays
nonzero until that later work is genuinely complete. The ordinary release test
gate uses the different, explicitly attested English-fallback scope while still
running the other translation-repair safety tests.

## Stable-release requirements

Before the narrowed release may deploy, the repository must prove all of the
following:

- every advertised localized route maps to complete, source-current, fluent
  packs;
- every unadvertised locale/route combination resolves through canonical
  English navigation and is absent from localized sitemap/static output;
- the OpenNext Static Asset contract is derived from the exact availability
  manifest instead of assuming all 69 languages have all 17 localized static
  documents;
- the current localized document matrix is exact at 245 entries and has no
  missing or extra paths; no R16/R17 Afrikaans path is added;
- all 69 main-app bundles remain complete;
- no incomplete legacy translation API response is materialized;
- the fallback-only release attestation binds the exact source manifest,
  availability manifest, translation trees, 7,957-entry pending ledger,
  668-row D1 corpus, and fallback policy; the separate immutable build and
  candidate seals bind the generated Static Assets;
- the full unit, typecheck, lint, OpenNext, Cloudflare preview, authenticated
  E2E, resource-budget, and release-rehearsal gates pass; and
- after those local gates, the exact owner trust statement is recorded in one
  private, clean-Git/source-bound acceptance artifact; every supported remote
  command validates it before starting a child process, and the schema-v2
  Worker deploy preparation carries its exact artifact hash into the upload
  and activation chain; and
- production translation synchronization uses only the separately verified
  fallback-only D1 plan: the uploaded-inactive phase is read-only, and the
  candidate-active phase performs one guarded atomic reset/upsert/delete to the
  exact 668-row set followed by symmetric byte readback.

The full multilingual semantic-release attestation must not be forged or
relabelled for this partial release. Deploy preflight must validate the new
fallback-release attestation as a distinct contract.

## Evidence

| Gate | Required result | Final evidence |
| --- | --- | --- |
| Translation pipeline tests | All focused TypeScript assertions pass | Cycle-free current implementation: 68/68 focused TypeScript assertions green |
| Translation Worker tests | All Python and TypeScript wrapper assertions pass | Current Python Worker pack: 99/99 green |
| Deterministic runtime smoke | Two fresh reports, identical output hash, hard mode, seed 0, zero writes | Passed twice: output `84c6351014568aa6c585c16d33b27d659d9c86911fcb6214f3f330cdbbe005f6`; no socket observed |
| Historical salvage acceptance | Fresh, private, final-hash-bound, candidate-input-only evidence for any future run | R13 was valid for R17 candidate input at the time; it is now implementation-stale and grants no current or future authority |
| Afrikaans generation | 121/121 candidates, offline, one worker, no socket breach | R16 and R17 each failed closed at 119/121 on distinct one-source/two-pack fluency edges; concluded without promotion |
| Afrikaans semantic audit | 125 packs, 16,564 fields, zero failures | Not run; partial candidates are ineligible |
| Afrikaans promotion | Immutable committed transaction and regenerated manifests | Not run and not authorized |
| Main-app static bundles | 69/69 complete and fluent | 69 × 1,878 strings verified; see hashes below |
| English fallback contract | Exact availability-derived routes and canonical English fallback | Current 245 entries and zero invalid advertised namespaces; no new Afrikaans paths |
| Fallback release attestation | Exact tracked, source-bound, fail-closed fallback-only artifact | Passed: `translations/current-fallback-no-site-promotion-attestation.json`, 1,595,690 bytes, file SHA-256 `1eceacc7…9ddec`, self-hash `4f0f7bb8…da710`, 599 + 69 = 668 rows and 245 paths |
| Production trust seal | Exact statement, fresh local gates, clean pushed source, private single-link artifact, and mandatory guarded remote entry points | Implementation contract 5/5 and deploy-preflight integration 62/62 green; the real release artifact is intentionally absent until every local gate passes and the owner accepts |
| Production translation writes | Exact two-phase reconciliation of the current trusted corpus only | Not performed; uploaded-inactive read-only plan/verification and candidate-active atomic reset/upsert/delete plus symmetric byte readback must prove the exact 668-row set |

Update this table with exact artifact paths, counts, hashes, and test totals as
the release gates complete. Do not record estimates as evidence.

Current exact evidence details:

- main-app source:
  `fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0`;
- availability set:
  `41bed771c2962f7c7b6442fcf5dcafe4c514fa5011094f3a0dfe2bbe1f1c9571`;
- localized HTML path set:
  `b4d165a100390416e1ab1b9cc7de2389f534cb5e717d2a6f90dcb2b9d0ad7d99`;
- site source-manifest file:
  `6d88d92db1908e7a0b29b0a34d622a10d1abb05fec9ae41343c0e4cfe18351c2`;
- site source catalog:
  `abc197b27570eb287ac32a8ce742483d0fa87c4bc3ed987b1a7cca48a231077d`;
- full target identity set:
  `7bbe0458266a4dd3208163009f8f3d1be945354b855da73458673232d18406fe`;
- current clean target identity set:
  `f1b71f9265bb0c4bf173713c1056bd70841dd58a71c0ae074189e479c78d0ac4`;
- current 7,957-entry pending ledger:
  `9282e41b1b2bb3c78509c452c5fa363bc3cad9dca00eb83e4496061e410760c9`.

The current no-site-promotion attestation was created at
`2026-07-15T23:36:39.092Z`. Its exact file SHA-256 is
`1eceacc73dc7966e4e7fa86cab7aee65e21277d0f3b8269a8760b9c4e579ddec`
and its canonical self-hash is
`4f0f7bb86964a1f433c30ab25fbb6a4434d92b7136fd920c5de06f77e94da710`.
Independent nofollow reread reconstructed 599 site rows and 69 main-app rows.
The D1 row-set hash is
`d05bb8353f4f007c0ca0738b24d6f883b799e10d85b5a13f43ebb32d8650d177`,
the payload-corpus hash is
`45ddea60466c9bb04d022cf36fee0daf0c97618306c8a0aadccd6c25657d3206`,
the generated 1,468-statement SQL hash is
`8c399d760c511ffac54a8fd4f1da42b6f17745384bde42405258331e6953f7ea`.
The enclosing canonical plan hash is
`f8b86233b0a4d55f6ae327568999377ea98d637938660917b282d5171c869152`.
The plan contains 1,466 logical upserts and remains local non-authority
evidence until the complete release chain admits it.

The current source-freshness/resource/fallback pack is 42/42, the broader
deploy/static/seal/override group is 115/115, package-script contracts are
28/28, and current whole-repository typecheck and lint are green. React Doctor
is 100/100 with zero diagnostics. These are interim checks, not substitutes for
the final source-bound aggregate local gate.

The first whole-repository test run after the staged-D1 work reported 1,519 of
1,540 passing. Eighteen failures are all in the single full-corpus and
legacy-delta completion suite. The three actionable failures—one
accepted-salvage barrier and two deploy-runbook ordering/scope assertions—are
now covered green. Independent current-branch checks passed strict TypeScript,
lint, a 103/103 core fallback/D1/preflight/seal pack, a 60/60
package/salvage/release-order pack, and the 45/45 factual
source/attestation/static audit. The latest pre-final-cleanup whole-repository
run completed in 291.1 seconds with 1,524 of 1,542 tests passing and exactly
the same 18 deferred-completion/legacy-delta cases red. No unrelated failure
remained. The fallback release now keeps that strict 8,556-pack suite as a
separate, explicitly runnable future-completion command while the ordinary
release unit gate covers every other test plus the exact current-fallback
attestation. The current release suite enumerates all 134 top-level test
files and is required to exit zero on the final frozen source. The dedicated completion command still runs all 62
translation-repair cases with no skips or todos: 44 pass and the exact 18
documented full-corpus/legacy-delta cases remain red. This is the expected
future-work signal, not release evidence for the fallback branch.

The first Cloudflare preview run exercised 18 experiences: 12 passed, the two
production-only checks were skipped as designed, and four live-AI checks
returned 503. Those four were authenticated memory recall, quiz, flashcards,
and guest chat. The preview harness did not forward a local
`CLOUDFLARE_AI_GATEWAY_TOKEN` into the Worker runtime, so that result is not
release evidence. The harness now resolves only the Gateway token from the
operator environment or an owner-only `.dev.vars`, excludes it from the build,
injects it only into the temporary mode-`0600` Wrangler runtime file after the
artifact scan, redacts every output/evidence representation, and restores the
original file. Its focused security pack is 104/104 green. A real token is not
configured locally yet, so the 18-experience preview must still be rerun; the
tests must not be weakened or replaced with mocked AI.

The historical private R13 acceptance additionally bound planning master
`137f4d890be10aec9bf85d5955b08607e69bce3d824cc49c0a532789724fe815`,
seed `52aec2828f110be8417a362d6b262f22c29f61decb2f0323114705dbfdea7200`,
evidence `f692ba9487a073aa3daf821028b67e72fbf359d76ea5b65ca8f32bc5979ce391`,
acceptance `6d0ffe0cf906180b29486a9f321557984d81b166187223e948cc453b11eee71f`,
233,255 result entries, and 6,172 conflicts. The evidence-file SHA-256 is
`983cebde45606010b815687dcf58d3c3215a8f6cf04239149bedf19173f10377`
and the acceptance-file SHA-256 is
`a3e57a86936979460f67d4199cc848f4c1c3b98937f7f484c7faec7a0cbb81f4`.
These hashes are retained only as R17 history. Current generator/salvage bytes
differ, so the artifact must not be reused for any future generation,
promotion, deployment, or production decision.

Both fresh runtime smokes used model
`7c8405cf19e969e93c0a3a04d7ed7db750f8790495f9c55182d354dae61fe2a8`
and execution profile
`807a3bc739832f9a199618731b007dae93a8053027b971e0715e4f9ea550db8b`.
Each reported MPS float16, hard determinism enabled, warning-only disabled,
manual seed 0, EOS observed, 14 generated tokens, identical output hash, and
zero writes. Live process sampling observed no network socket.

## Operational boundaries

- Translation generation and audit are local-only and must remain offline.
- Ignored worklists, candidates, logs, salvage inputs, models, and temporary
  reports are never committed.
- Candidate-input acceptance grants no promotion, deployment, or production
  authority.
- No production D1 read/write, migration, synchronization, repair, Worker
  upload, activation, deploy, or production validation is authorized until the
  separate release gates and the recorded production trust-boundary acceptance
  are complete. The local acceptance command performs no remote access, rejects
  dirty or unpushed source, and is the mandatory entry seal for every supported
  remote package command. The required owner statement is: “I accept the fresh trust
  boundary and understand that the 13 July-to-cutover identity interval cannot
  be cryptographically re-proven.” It has not been provided at this checkpoint
  and must not be requested until every local release gate is green.
- Accounts, users, saved chats, memory, admin/auth APIs, learning modes, quiz,
  flashcards, and saved results are outside this translation deferral and must
  remain preserved by their existing release gates.
