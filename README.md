# inspir

Learning is for everyone.

inspir is an AI learning companion rebuilt from the original Bubble product into a production Next.js application. The goal is simple and ambitious: make learning feel accessible, personal, playful, and useful for anyone with curiosity and an internet connection.

Live app: [https://inspirlearning.com](https://inspirlearning.com)

## Mission

At inspir, we believe learning should not belong only to people with the right school, the right tutor, the right language, or the right amount of free time.

The internet made information abundant, but not always understandable. AI gives us a chance to turn that abundance into a patient learning partner: one that can explain, question, quiz, debate, role-play, translate, adapt, and keep going until the idea finally clicks.

This repository exists to build that future in public: a focused, practical learning app where people can explore anything from black holes to bread-making, practice with quizzes, learn through Socratic questions, debate ideas, and step into history through guided conversation.

## What the app does

inspir gives learners topic-based AI modes rather than a single generic chat box:

- Learn Anything: clear explanations for any topic.
- Socratic Instruction: questions that guide the learner toward understanding.
- Collaborative Instruction: shared workroom for learning, critique, decisions, and artifact-building.
- Interactive Instruction: explain, quiz, adapt, repeat.
- Quiz me on Trivia: text-in-chat multiple choice quizzes with scoring.
- Time travel: explore another era through an AI local guide.
- Talk to a historical person: converse with figures from history.
- Debate with a personality: debate a real or fictional personality.
- Debate any topic: sharpen thinking by arguing both sides.

The product preserves the behavior and visual language of the original Bubble app while replacing the implementation with a safer, faster, extensible production stack.

## Highlights

- Pixel-focused Bubble rebuild across landing, legal pages, loading, reset, chat, profile, and history states.
- Google sign-in through Auth.js / NextAuth.
- Server-only OpenAI calls through the AI SDK.
- Cloudflare D1 with Drizzle ORM.
- Cloudflare Vectorize for memory embeddings.
- Cloudflare R2 for OpenNext incremental cache.
- Persisted chats, messages, users, topics, profile data, and AI run telemetry.
- Bubble CSV import pipeline with strict and best-effort migration modes.
- Admin-only topic creation guarded by environment-based allowlists.
- Modernized chat experience with streaming responses and polished loading states.
- Production deployment through OpenNext on Cloudflare Workers.

## Tech stack

- Next.js App Router
- React and TypeScript
- AI SDK
- OpenAI
- Auth.js / NextAuth with Google OAuth
- Drizzle ORM
- Cloudflare D1
- Cloudflare Vectorize
- Cloudflare R2
- Tailwind CSS and custom CSS
- Cloudflare Workers
- Node test runner and Playwright-ready visual QA

## Repository map

```txt
app/                 Next.js routes, layouts, API handlers, public pages
components/          Brand, marketing, legal, admin, and chat UI
lib/ai/              Topic prompts, agent setup, AI utilities
lib/auth/            Auth config, session helpers, admin checks, photo sync
lib/content/         Extracted Bubble legal, mission, and topic content
lib/db/              Drizzle schema, database client, query helpers
lib/migration/       CSV parsing and Bubble import helpers
lib/utils/           Shared date, slug, and rate-limit utilities
scripts/             Bubble import, validation, and content extraction scripts
tests/               Unit tests for utility and migration behavior
```

## Getting started

Install dependencies:

```bash
pnpm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Fill in the required values:

```txt
OPENAI_API_KEY=
CLOUDFLARE_AI_GATEWAY_TOKEN=
CLOUDFLARE_AI_GATEWAY_BASE_URL=
CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS=
OPENAI_MODEL=gpt-5
OPENAI_FAST_MODEL=gpt-5-mini
OPENAI_REASONING_MODEL=gpt-5
OPENAI_STRUCTURED_MODEL=gpt-5-mini
AUTH_SECRET=
NEXTAUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
ADMIN_EMAILS=
APP_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
```

Run the app:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

For Cloudflare parity, build and preview with OpenNext:

```bash
pnpm cf:build
pnpm cf:preview
```

Open [http://localhost:8787](http://localhost:8787).

## Database

Generate migrations:

```bash
pnpm db:generate
```

Apply migrations:

```bash
pnpm db:migrate
```

## Cloudflare data migration

The production migration path is backed by local timestamped backups and Cloudflare import/validation scripts:

```bash
CONFIRM_WRITE_FREEZE=1 \
CONFIRM_FINAL_BACKUP=1 \
CONFIRM_BACKUP_SOURCE_WRITES_FROZEN=1 \
MIGRATION_WRITE_FREEZE_STATUS_URL=https://inspirlearning.com/api/migration/write-freeze \
pnpm cf:migration:backup -- --final
pnpm cf:migration:prepare
pnpm cf:migration:rehearse:d1:local
pnpm cf:migration:rehearse:vectorize:local
pnpm cf:harden:backup-permissions
CONFIRM_WRITE_FREEZE=1 \
CONFIRM_D1_IMPORT=1 \
CONFIRM_D1_DATABASE_NAME=inspirlearning-prod \
CONFIRM_D1_DATABASE_ID=7cb2ddf7-ca3d-4f46-a022-cc8b3a25b7b9 \
CONFIRM_BACKUP_DIR="$(pwd)/../inspirlearning-local-backups/<cloudflare-migration-dir>" \
pnpm cf:migration:import:d1
pnpm cf:migration:validate:d1
CONFIRM_WRITE_FREEZE=1 \
CONFIRM_VECTORIZE_IMPORT=1 \
CONFIRM_VECTORIZE_INDEX=inspirlearning-memory-prod \
CONFIRM_BACKUP_DIR="$(pwd)/../inspirlearning-local-backups/<cloudflare-migration-dir>" \
pnpm cf:migration:import:vectorize
pnpm cf:status:migration
pnpm cf:cutover:checklist
pnpm cf:evidence:verify
```

`pnpm cf:migration:prepare` also writes source-table coverage and D1 size-safety reports. Those fail the migration if a Supabase public table is not explicitly migrated, or if any transformed D1 row/value/statement exceeds Cloudflare limits.

Important: raw exports, backups, provider snapshots, and secrets may contain personal data. Do not commit them. The final provider backup must run with `pnpm cf:migration:backup -- --final` after the serving app is frozen; it writes `cloudflare/write-freeze-report.json`, and production preflight refuses rehearsal backups or backups without frozen-source evidence. The Cloudflare import commands mutate production D1/Vectorize resources and require explicit write-freeze confirmations. Set `APP_WRITE_FREEZE=1` on the serving app during the final freeze so durable writes return `503 write_freeze_active` while read-only traffic continues. Run `pnpm cf:harden:backup-permissions` after regenerating final backup artifacts; preflight re-checks that the backup tree is owner-only and has no symlinks. The production preflight also writes a key-name-only env migration inventory, `pnpm cf:cleanup:duplicate-secrets` can remove reviewed Cloudflare secret/var duplicates, and the final cutover checklist is generated into the selected local backup directory with exact confirmation values but no secret values. `pnpm cf:verify:local` records a repo source fingerprint and writes `cloudflare/source-secret-scan-report.json` plus `cloudflare/runtime-provider-scan-report.json` so the preflight rejects stale build evidence, provider tokens accidentally added to source, or retired Vercel/Supabase/Postgres runtime dependencies. `pnpm cf:verify:credential-rotation` writes the final post-delete credential revocation report; migration status is not complete until that and provider hard-delete both pass. `pnpm cf:status:migration` and `pnpm cf:cutover:checklist` refresh `cloudflare/evidence-manifest.json`, a SHA-256 manifest for the local backup and generated migration evidence; `pnpm cf:evidence:verify` verifies that manifest. Rerun `pnpm cf:evidence:verify` after every manifest refresh and immediately before provider-retirement preflight/apply.

Cloudflare also owns post-turn memory work through the `inspirlearning-memory-post-turn-prod` Queue and `inspirlearning-memory-post-turn-dlq` dead-letter Queue. Chat responses enqueue memory extraction after the answer finishes; the Worker queue consumer processes memory against D1/Vectorize with retry support, keeping long-running memory synthesis off the request path.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For production parity work, also run:

```bash
pnpm cf:verify:local
pnpm cf:test:e2e:preview
```

## Contributing

We would love thoughtful contributions from people who care about learning, AI, accessibility, education, language, design, and open product craft.

Good ways to help:

- Improve the learning modes and system prompts.
- Add tests around chat, auth, imports, and admin flows.
- Polish mobile and tablet UI details.
- Improve accessibility and keyboard navigation.
- Strengthen migration tooling and data validation.
- Add safe, useful learner features without making the product feel heavy.
- Report bugs with screenshots and reproduction steps.

Start with [CONTRIBUTING.md](CONTRIBUTING.md). If you are unsure where to begin, open an issue with the area you care about and we can shape it together.

## Security

AI products touch sensitive user data, auth flows, and provider keys. Please do not open public issues for secrets, auth bypasses, data exposure, or abuse vectors. Follow [SECURITY.md](SECURITY.md).

## Project values

- Learners first.
- Clarity over cleverness.
- Server-side secrets only.
- Preserve trust.
- Small, useful improvements over flashy complexity.
- Make learning feel less lonely.

## License

MIT. See [LICENSE](LICENSE).
