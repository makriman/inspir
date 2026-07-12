# inspir

Learning is for everyone.

inspir is an AI learning companion built with Next.js and delivered through a static-first native Cloudflare Worker. The goal is simple and ambitious: make learning feel accessible, personal, playful, and useful for anyone with curiosity and an internet connection.

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

The product preserves the core learning behavior on a Cloudflare-native stack that is portable, typed, tested, and built for careful operational work.

## Highlights

- Polished product UI across landing, legal pages, loading, reset, chat, profile, and history states.
- Google sign-in through Better Auth on Cloudflare D1.
- Server-only OpenAI calls through Cloudflare AI Gateway.
- Cloudflare D1 with Drizzle ORM.
- Cloudflare Vectorize for memory embeddings.
- Cloudflare R2 for profile image storage.
- Cloudflare Queues for post-turn memory work.
- Persisted chats, messages, users, topics, profile data, and AI run telemetry.
- First-party product analytics and ops telemetry in D1, with GA and Clarity installed client-side.
- Cloudflare operational checks for local gates, source scans, build artifact scans, preview, and production smoke tests.
- Admin dashboard for AI usage, quota posture, product analytics, topics, and admin management.
- Modernized chat experience with streaming responses and polished loading states.
- Multilingual curated static bundles with source-hash and fluency gates.
- Games and the game arena are absent; accounts, saved chats, memory, admin, and learning APIs remain.
- OpenNext is build tooling only; Wrangler deploys direct Static Assets plus a framework-neutral native Worker.

## Tech stack

- Next.js App Router
- React and TypeScript
- AI SDK
- OpenAI
- Better Auth with Google OAuth
- Drizzle ORM
- Cloudflare D1
- Cloudflare Vectorize
- Cloudflare R2
- Tailwind CSS and custom CSS
- Cloudflare Workers
- Node test runner and Playwright production QA

## Repository map

```txt
app/                 Next.js routes, layouts, API handlers, public pages
components/          Brand, marketing, legal, admin, and chat UI
lib/ai/              Topic prompts, agent setup, and AI utilities
lib/auth/            Auth config, session helpers, admin checks, photo sync
lib/content/         Legal, mission, topic, blog, language, and SEO content
lib/db/              Drizzle schema, database client, query helpers
lib/migration/       Write-freeze utilities for guarded maintenance windows
lib/utils/           Shared date, slug, and rate-limit utilities
scripts/             Cloudflare deployment, translation, and maintenance scripts
tests/               Unit tests for app behavior, Cloudflare operations, and SEO
```

## Getting started

Install dependencies:

```bash
pnpm install
```

Use Node.js `20.9.0` or newer. The package is marked `private` because this repo is an application, not an npm package.

Create a local environment file:

```bash
cp .env.example .env.local
```

Fill in the values needed for the feature you are working on. Keep real provider keys, auth secrets, Cloudflare tokens, backups, and generated reports out of git.

Run the app:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

For Cloudflare parity, build and preview the native Worker plus materialized OpenNext static output:

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

Never apply production migrations through the generic Drizzle command. Production releases use the source-bound, Free-budgeted migration sequence in [`deploy.md`](deploy.md):

```bash
pnpm cf:check:d1-migration-budget -- --confirm-production
pnpm cf:apply:d1-runtime-migrations -- --confirm-production
pnpm cf:verify:d1-runtime-migrations -- --confirm-production
```

For day-to-day local Cloudflare preview, prefer the local D1 setup command:

```bash
pnpm cf:d1:local:setup
```

The historical `ai_response_cache` table remains migration-compatible, but the Workers Free native runtime does not read or write it.

## Cloudflare Operations

Public documents, localized pages, SEO files, topic JSON, and frontend assets are direct Workers Static Assets. Only the exact account, saved-state, learning, admin, analytics, health, chat-child, and tutor routes invoke the native Worker. D1 stores relational data, Vectorize supports memory retrieval, R2 stores profile images, and a Queue performs bounded post-turn memory work. Neither Next nor the OpenNext request runtime is imported by the deployed Worker.

Useful commands:

```bash
pnpm cf:d1:local:setup
pnpm cf:preview
pnpm cf:verify:local
pnpm cf:preflight:deploy
pnpm cf:deploy
REQUIRE_LIVE_AI=1 pnpm cf:verify:production
```

`pnpm cf:verify:local` records typecheck, Worker typecheck, lint, unit tests, source secret scan, Next build, OpenNext build, artifact scan, Wrangler dry run, and Worker startup evidence under `tmp/cloudflare-reports/`. The deploy wrapper uses the same report directory for preflight evidence and refuses production deploys when the local gates or artifact scans are stale.

Cross-store frozen backup and destructive whole-D1 restore are intentionally unsupported on the
Workers Free architecture. Connected HTTP invocations have no finite wall-time ceiling, while
Queue and cron consumers can run for 15 minutes, so a deployment-time write-freeze cannot prove
that every previously admitted D1, R2, Vectorize, Queue, or `waitUntil` mutation has drained.
Release maintenance therefore uses additive migrations, atomic scoped imports, Time Travel
bookmarks for diagnostics, and reviewed forward corrections only. Generated reports can contain
personal data or environment fingerprints; keep them local and out of git.

Cloudflare also owns post-turn memory work through the `inspirlearning-memory-post-turn-prod` Queue and `inspirlearning-memory-post-turn-dlq` dead-letter Queue. Chat responses enqueue memory extraction after the answer finishes; the Worker queue consumer processes memory against D1/Vectorize with retry support, keeping long-running memory synthesis off the request path.

The production Worker is `inspirlearning`, backed by:

- D1: `inspirlearning-prod`
- Vectorize: `inspirlearning-memory-prod`
- R2: `inspirlearning-profile-images-prod`
- Queue: `inspirlearning-memory-post-turn-prod`
- DLQ: `inspirlearning-memory-post-turn-dlq`

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
