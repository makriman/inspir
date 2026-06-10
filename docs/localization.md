# Localization Workflow

The app does not translate text at user request time. Production reads completed static bundles from
`translations/curated/<locale>/<namespace>.json`; missing bundles are a data-prep problem, not a
runtime model call.

## Manual Curated Packs

Export source text for a language and namespace:

```bash
pnpm translations:export -- --languages=Hindi --namespace=route:home --dir=translations/curated
```

For large namespaces, split the pack into smaller files that can be assigned to different agents:

```bash
pnpm translations:export -- --languages=Icelandic --namespace=main-app --dir=translations/curated --chunk-size=250
```

Chunk files are named like `main-app.part-001-of-010.json`. The runtime merges all complete files
for the same language and namespace into one bundle.

Fill every `entries[].value` in the exported JSON file. Preserve:

- placeholders like `{name}`
- URLs, route slugs, file names, and code identifiers
- markdown syntax, links, and code fences
- the product name `inspir`

Validate a completed pack:

```bash
pnpm translations:import -- --languages=Hindi --namespace=route:home --dir=translations/curated --dry-run
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
still exists as a temporary bridge for migrating older cached DB rows into curated files, but the app
does not rely on translation API routes or provider-backed workers.

## Cache Export Bridge

Export already-completed legacy cache rows to curated files:

```bash
pnpm translations:export-cache -- --all-languages --namespace=main-app --namespace=marketing-shell
```

This bridge never calls model providers; it only copies fresh, complete cache rows into static JSON.
