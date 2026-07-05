# Security Policy

Security matters here because inspir handles authentication, user messages, provider APIs, and AI responses.

## Reporting a vulnerability

Please do not open a public GitHub issue for security problems.

If you find a vulnerability, contact the repository owner privately with:

- A short summary.
- Steps to reproduce.
- The affected route, API, or workflow.
- Any relevant screenshots or logs with secrets removed.
- The impact you believe it may have.

If you are unsure whether something is security-sensitive, report it privately first.

## What to report privately

- Exposed API keys or OAuth secrets.
- Authentication bypasses.
- Cross-user data exposure.
- Prompt or tool behavior that leaks private data.
- Server-side request forgery or unsafe file access.
- Unsafe database access.
- Admin route bypasses.
- Production data leaks.

## Secrets and data

- Never commit `.env`, `.env.local`, local backups, provider keys, or production data.
- OpenAI and Google credentials must stay server-side.
- Operational logs should avoid printing real user emails or private message content.

## Supported versions

Security fixes target the current `main` branch unless the maintainer announces a release policy.
