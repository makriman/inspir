# Contributing to inspir

Thank you for wanting to help.

inspir is about making learning more accessible, more human, and more useful. Contributions are welcome from engineers, designers, educators, researchers, writers, students, and curious people who can spot where the product should feel clearer.

## How to contribute

1. Open an issue for bugs, ideas, accessibility problems, or design inconsistencies.
2. Comment on an existing issue if you want to help with it.
3. Keep pull requests focused and easy to review.
4. Include screenshots or short recordings for UI changes.
5. Run the checks before asking for review.

## Local setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Use Node.js `20.9.0` or newer.

You will need local environment variables for database, auth, and AI features. Never commit `.env`, `.env.local`, local backups, provider keys, or production data.

## Checks

Run these before opening a pull request:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For deployment or production-facing changes, also run:

```bash
pnpm cf:verify:local
pnpm cf:test:e2e:preview
```

## Pull request expectations

Please include:

- What changed.
- Why it changed.
- How it was tested.
- Screenshots for visual changes.
- Any migration, environment, or deployment notes.

Keep PRs small when possible. A focused improvement is much easier to review than a bundle of unrelated cleanup.

## Areas that need care

### Learning quality

Topic prompts should be clear, respectful, and useful. The app should help people understand, not just generate impressive text.

### UI polish

When changing shared UI, check desktop, tablet, and mobile.

### Privacy and safety

Keep API keys and provider secrets server-side. Avoid logging personal data. Do not expose raw migration data.

## Good first contributions

- Add focused tests around utility functions.
- Improve empty and error states.
- Tighten mobile spacing in one route.
- Improve README examples or docs.
- Add accessibility labels where they are missing.
- Reproduce and document a bug clearly.

## Code style

- Prefer the patterns already used in the codebase.
- Keep changes scoped.
- Add comments only when they explain non-obvious behavior.
- Do not introduce new dependencies unless they remove real complexity.
- Never put secrets in client components.

## Community

Be generous with context. Assume people are here because they care about learning. Help make the repo a place where a new contributor can feel useful quickly.
