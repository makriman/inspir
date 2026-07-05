# inspir

Learning is for everyone.

inspir is an AI learning companion rebuilt into a production Next.js application running on Cloudflare. The goal is simple and ambitious: make learning feel accessible, personal, playful, and useful for anyone with curiosity and an internet connection.

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

The product preserves the core learning behavior while replacing earlier prototypes with a safer, faster, extensible production stack.

## Highlights

- Polished product UI across landing, legal pages, loading, reset, chat, profile, and history states.
- Google sign-in through Auth.js / NextAuth.
- Server-only OpenAI calls through the AI SDK.
- Cloudflare D1 with Drizzle ORM.
- Cloudflare Vectorize for memory embeddings.
- Cloudflare R2 for OpenNext incremental cache.
- Persisted chats, messages, users, topics, profile data, and AI run telemetry.
- Cloudflare operational checks for local gates, source scans, build artifact scans, preview, and production smoke tests.
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

Apply remote D1 migrations only when you intentionally provide maintainer credentials:

```bash
CLOUDFLARE_ACCOUNT_ID=<account-id> \
CLOUDFLARE_D1_DATABASE_ID=<database-id> \
CLOUDFLARE_API_TOKEN=<token> \
pnpm db:migrate
```

For day-to-day local Cloudflare preview, prefer the local D1 setup command:

```bash
pnpm cf:d1:local:setup
```

## Cloudflare Operations

The app runs on Cloudflare Workers through OpenNext, with D1 for relational data, Vectorize for memory retrieval, R2 for the OpenNext cache, and a Queue for post-turn memory work.

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

Cloudflare data backups are explicit operational tasks, not part of every deploy:

```bash
pnpm cf:backup:frozen-cloudflare
pnpm cf:harden:backup-permissions -- --backup <backup-dir>
```

Backups and generated reports can contain personal data or environment fingerprints. Keep them local and out of git.

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
