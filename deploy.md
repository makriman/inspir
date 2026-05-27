# Deployment Guide

This project deploys to Vercel from the local workspace and uses Drizzle migrations for database changes.

## Prerequisites

- You are on the branch you intend to deploy, usually `main`.
- Vercel is already linked for this repo.
- Production environment variables are configured in Vercel.
- `pnpm` dependencies are installed.

## 1. Check The Worktree

Review local changes before committing so unrelated edits do not get bundled into the release.

```bash
git status --short
git diff --stat
```

## 2. Run Verification

Run the standard checks before deploying.

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Notes:

- `pnpm lint` may report existing `<img>` warnings. Treat new lint errors as blockers.
- Local builds may fall back to WASM Next.js bindings on macOS if the native SWC package has a code-signing issue. The build is still valid if it exits successfully.

## 3. Generate Migrations When Schema Changes

If `lib/db/schema.ts` changed, generate a migration.

```bash
pnpm db:generate --name short_migration_name
```

Review the generated SQL before applying it.

```bash
cat drizzle/000X_short_migration_name.sql
```

## 4. Apply Production Database Migrations

Pull production environment variables into a local ignored file, then run migrations against production.

```bash
pnpm exec vercel env pull .env.vercel.production.local --environment=production
set -a; source .env.vercel.production.local; set +a; pnpm db:migrate
```

The `.env.vercel.production.local` file is ignored by git. Do not commit it.

## 5. Commit And Push

Stage only the intended release files.

```bash
git add <files>
git commit -m "Clear release message"
git push
```

## 6. Deploy To Production

Deploy the current workspace to Vercel production.

```bash
pnpm exec vercel deploy --prod
```

Confirm the CLI reports:

- `readyState` is `READY`
- the deployment is aliased to `https://inspirlearning.com`

## 7. Smoke Check Production

Open the production site and confirm the page loads.

```bash
open https://inspirlearning.com
```

For app changes, sign in and quickly check the affected flow, including any database-backed feature touched by the release.

## Current Production Targets

- Production domain: `https://inspirlearning.com`
- Vercel project: `makrimans-projects/inspirlearning`
- GitHub repo: `https://github.com/makriman/inspir.git`
