# Localization Workflow

The app does not translate text at user request time. Translation packs are generated and validated
offline. The Workers Free deployment publishes curated site HTML and tracked static main-app bundles;
D1 mirrors the audited translation rows but is not on the page-rendering path. Missing rows or files
are a data-prep problem, not a runtime model call.

## Manual Curated Packs

Export source text for a language and namespace:

```bash
pnpm translations:export -- --languages=Hindi --namespace=route:home --dir=translations/curated
```

For large namespaces, split the pack into smaller files that can be assigned to different agents:

```bash
pnpm translations:export -- --languages=Icelandic --namespace=main-app --dir=translations/curated --chunk-size=250
```

To continue a partially translated language, export only the missing keys:

```bash
pnpm translations:export-missing -- --languages=Hindi --namespace=main-app --dir=translations/curated --chunk-size=250
```

`translations:export-missing` reads existing curated packs for that language/namespace and writes only
entries without a validated value. Use this for parallel translation batches so completed strings are
not reworked or overwritten.

Chunk files are named like `main-app.part-001-of-010.json`. Before import, compact the chunk files
into the one-file-per-language bundle format:

```bash
pnpm translations:bundle -- --dir=translations/curated --out-dir=translations/curated-bundles --clean
```

The main-app editing shards are intentionally ignored. After reviewing changes to them, regenerate
the smaller values-only deployment snapshot and commit `translations/static-main-app/`:

```bash
pnpm translations:static-main-app -- --clean
pnpm translations:static-main-app:check
```

Each tracked pack is locked to the full main-app source hash and sorted key count. A stale, incomplete,
non-NFC, placeholder-breaking, or unchanged ordinary UI translation fails closed. Account, saved-chat,
profile, memory, and admin copy is part of that same complete contract. This snapshot lets a clean checkout
build every localized static chat shell without D1 or hidden workbench files.

Fill every `entries[].value` in the exported JSON file. Preserve:

- placeholders like `{name}`
- URLs, route slugs, file names, and code identifiers
- markdown syntax, links, and code fences
- the product name `inspir`

Validate a completed pack:

```bash
pnpm translations:import -- --languages=Hindi --namespace=route:home --dir=translations/curated --dry-run
```

Validate the compact import bundles:

```bash
pnpm translations:import -- --all-languages --all-namespaces --dir=translations/curated-bundles --dry-run
```

Import the validated bundles into the production database:

```bash
pnpm translations:import -- --all-languages --all-namespaces --dir=translations/curated-bundles
```

Validate an incomplete chunk set while work is still in progress:

```bash
pnpm translations:import -- --languages=Icelandic --namespace=main-app --dir=translations/curated --dry-run --allow-partial
```

Check static coverage:

```bash
pnpm translations:status -- --all-languages \
  --namespace=main-app \
  --namespace=marketing-shell \
  --namespace=route:home \
  --namespace=route:mission
```

The validator checks source hashes, missing fields, unknown keys, placeholder preservation, and
unchanged English where the target language should translate ordinary UI copy. `translations:import`
also uploads completed bundles into `app_translations`, but the app does not rely on translation API
routes or provider-backed workers.

## Audited Quality Repair

Use the quality-repair command for an audited field-level repair. It can inspect every existing
`main-app` or known site namespace pack without inventing language/namespace combinations that are
not already present:

```bash
pnpm translations:repair-quality --all-languages --all-existing-namespaces \
  --repair-scope-json=tmp/full-curated-corpus-forced-scope.json --plan
pnpm translations:repair-quality --all-languages --all-existing-namespaces \
  --repair-scope-json=tmp/full-curated-corpus-forced-scope.json \
  --export-worklists --worklist-dir=tmp/translation-repair-worklists
```

The scope is an ignored JSON object with exactly `schemaVersion: 1`, kind
`translation-repair-scope`, `fields`, a lexically keyed `sourceHashes` object, `entries`, and
`canonicalSha256`. Each entry has `language`, `locale`, `namespace`, `sourceHash`, `key`, `source`,
`existingCandidate`, and an optional sorted, unique `reasons` array. The command verifies current
namespace hashes, exact key/source parity, locale identity, current candidate parity, duplicate keys,
and a canonical SHA-256 before exporting anything.

The canonical rows are sorted by
`[locale, namespace, key, sourceHash, source, language, existingCandidate]`. Each row serializes
`[language, locale, namespace, sourceHash, key, source, existingCandidate]` with `JSON.stringify`;
rows are joined with `\n` and terminated by one final `\n`. Optional reasons do not alter the
identity hash.

A detector is only a worklist aid, not proof that an unselected field is fluent. If an audit finds
systemic corruption that the detector misses, force every field in the affected language/namespace
pack. Remove a detector false positive only when an independent review binds the exact language,
namespace, source hash, key, and current value; record that value as an exact reviewed preserve so
any source, key, or value drift fails closed.

Create one candidate JSON file for every exported worklist at the same locale/namespace-relative
path. Copy the worklist metadata and entry audit context exactly, change its kind to
`translation-repair-candidate`, add one non-empty `draftModel`, and replace each empty `value` with
the candidate translation. Do not add, omit, reorder, or mix files, keys, sources, models, reasons,
or existing candidates. Then run the read-only candidate gate before corpus validation or apply:

```bash
pnpm translations:validate-candidates \
  --worklist-dir=tmp/translation-repair-worklists \
  --candidate-dir=tmp/translation-repair-candidates
pnpm translations:repair-quality --all-languages --all-existing-namespaces \
  --repair-scope-json=tmp/full-curated-corpus-forced-scope.json \
  --validate-candidates \
  --worklist-dir=tmp/translation-repair-worklists \
  --candidate-dir=tmp/translation-repair-candidates
```

The candidate gate exact-binds candidate files and entries to their worklists and requires one draft
model across the corpus. It rejects empty, non-NFC, unapproved source-identical, excessively long, or
repetition-degenerated target values; placeholder, protected-literal, URL, email, or numeric drift;
and explicit English negation whose translation has no recognized target-language negation marker.
The deterministic negation lexicons cover every
supported target language and are a loss detector, not proof of semantic equivalence; flagged values
require correction or independent human review outside the apply command.
Direct application of an unmanifested candidate directory is forbidden. Complete the independent
semantic/high-quality workflow below and apply only its exact hybrid output and manifest.

For a large local-model repair, run a separate cross-lingual semantic audit over the complete primary
candidate tree. The audited hybrid composer can turn the union of semantic flags and deterministic
field failures into an exact subset worklist, then merge independently regenerated high-quality
replacements without allowing any unselected value to change:

```bash
pnpm exec tsx scripts/compose-hybrid-translation-candidates.ts export-subset \
  --worklist-dir=tmp/translation-repair-worklists \
  --primary-candidate-dir=tmp/translation-primary-candidates \
  --semantic-audit=tmp/translation-semantic-audit.json \
  --subset-worklist-dir=tmp/translation-high-quality-worklists \
  --selection-manifest=tmp/translation-hybrid-selection.json

pnpm exec tsx scripts/compose-hybrid-translation-candidates.ts merge \
  --worklist-dir=tmp/translation-repair-worklists \
  --primary-candidate-dir=tmp/translation-primary-candidates \
  --subset-worklist-dir=tmp/translation-high-quality-worklists \
  --beam4-candidate-dir=tmp/translation-high-quality-candidates \
  --selection-manifest=tmp/translation-hybrid-selection.json \
  --output-candidate-dir=tmp/translation-hybrid-candidates \
  --hybrid-draft-model=local-primary+high-quality-semantic-repair-v1 \
  --manifest=tmp/translation-hybrid-candidates.manifest.json

pnpm translations:repair-quality --all-languages --all-existing-namespaces \
  --repair-scope-json=tmp/full-curated-corpus-forced-scope.json \
  --validate-candidates \
  --worklist-dir=tmp/translation-repair-worklists \
  --candidate-dir=tmp/translation-hybrid-candidates \
  --candidate-manifest=tmp/translation-hybrid-candidates.manifest.json

pnpm translations:repair-quality --all-languages --all-existing-namespaces \
  --repair-scope-json=tmp/full-curated-corpus-forced-scope.json \
  --apply-candidates \
  --worklist-dir=tmp/translation-repair-worklists \
  --candidate-dir=tmp/translation-hybrid-candidates \
  --candidate-manifest=tmp/translation-hybrid-candidates.manifest.json
```

The semantic report must bind the exact worklist and primary-candidate paths, field count, identity,
source, existing value, and primary value. The composer rejects stale or duplicate flags, mixed or
incomplete models, structural drift, non-ignored outputs, and replacements that still fail field QA.
It writes a mode-`0600` canonical provenance manifest. Validation checks that manifest before
candidate ingestion; apply checks it again immediately before the atomic tracked write. Any changed
path, byte, digest, model, count, identity, selected value, symlink, or stale input fails closed.
Re-run the independent semantic audit on the merged tree; the composer proves identity and
deterministic quality, not semantic correctness by itself.

Forced scope entries determine the repair worklists but never bypass the normal field and whole-pack
fluency gates. Apply mode requires the exact scope, replaces only impacted existing packs, keeps the
source backup until generated main-app output and post-write status checks succeed, and rolls both
source packs and generated output back on failure. Production D1 mirroring remains a separate guarded
deployment step.

Translation-memory exports are untrusted inputs until separately reviewed against the final scope and
worklists. Seed only exact locale/source/value pairs with identity-bound evidence, quarantine every
unreviewed or unused row, and regenerate the seed manifest whenever the final scope or worklists change.

## Cache Export Bridge

Export already-completed legacy cache rows to curated files:

```bash
pnpm translations:export-cache -- --all-languages --namespace=main-app --namespace=marketing-shell
```

This bridge never calls model providers; it only copies fresh, complete cache rows into static JSON.

## Source Manifest

`lib/i18n/site-source-manifest.ts` is generated and intentionally tracked so Cloudflare runtime translation hashes are deterministic. Regenerate it whenever route copy, SEO copy, legal copy, topic copy, or localization source extraction changes:

```bash
pnpm translations:generate-site-source-manifest
```

The unit suite and production repair preflight compare every extracted namespace with the generated manifest, so stale namespace sets or source hashes fail before deployment.

Production source synchronization is incremental: it upserts only changed source rows, deletes only obsolete rows, never recreates the source tables, and fails closed above the repository's conservative Workers Free D1 write budget. Remote synchronization requires `--confirm-production`; the SEO CTA repair combines the source diff and payload repair into one atomic D1 SQL-file execution.

The SEO translation repair also mirrors the tracked `marketing-shell`, `route:home`,
`route:mission`, and `main-app` bundles into D1. Its default verify mode is local-only: it requires
all 69 non-English rows per curated namespace to pass whole-bundle fluency, checks every generated
statement against D1's 100,000-byte limit, and proves a conservative cold-manifest projection stays
within the reserved 50,000-row-write Workers Free release budget. Existing mission rows may be
missing before the UPSERT; post-write verification requires exactly 69 mission rows with the expected
source hash, complete payload, and curated model provenance.
