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
non-NFC, placeholder-breaking, or unchanged ordinary UI translation fails closed. This snapshot lets a
clean checkout build every localized static chat shell without D1 or hidden workbench files.

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
pnpm translations:status -- --all-languages --namespace=route:home
```

The validator checks source hashes, missing fields, unknown keys, placeholder preservation, and
unchanged English where the target language should translate ordinary UI copy. `translations:import`
also uploads completed bundles into `app_translations`, but the app does not rely on translation API
routes or provider-backed workers.

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
