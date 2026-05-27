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
- Collaborative Instruction: Hindi-first study partner mode.
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
- Server-only OpenAI calls through the Vercel AI SDK.
- Neon Postgres with Drizzle ORM.
- Persisted chats, messages, users, topics, profile data, and AI run telemetry.
- Bubble CSV import pipeline with strict and best-effort migration modes.
- Admin-only topic creation guarded by environment-based allowlists.
- Modernized chat experience with streaming responses and polished loading states.
- Production deployment through Vercel.

## Tech stack

- Next.js App Router
- React and TypeScript
- Vercel AI SDK
- OpenAI
- Auth.js / NextAuth with Google OAuth
- Drizzle ORM
- Neon Postgres
- Tailwind CSS and custom CSS
- Vercel
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
DATABASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
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

## Database

Generate migrations:

```bash
pnpm db:generate
```

Apply migrations:

```bash
pnpm db:migrate
```

## Bubble data migration

The original Bubble export did not include every Bubble unique ID, so the importer supports two modes:

- `best-effort`: imports reconstructable users, topics, messages, and legacy snapshots.
- `strict`: fails unless complete unique IDs are present for deterministic production migration.

Run a best-effort import:

```bash
pnpm import:bubble
```

Validate the import:

```bash
pnpm validate:import
```

Important: raw Bubble CSVs may contain personal data. Do not commit raw exports, secrets, or private migration files.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For production parity work, also run:

```bash
vercel build --prod --yes
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

No open source license has been declared yet. Until a license is added, all rights are reserved by the repository owner.
