# Inspir Bubble Rebuild Notes

- Rebuilt the Bubble app as a Next.js App Router application with Drizzle, Auth.js/NextAuth Google OAuth, Vercel AI SDK, and Postgres-compatible Neon storage.
- Preserved the nine topic modules, Bubble-style dark chat shell, public routes, loading/reset/404 pages, social links, profile drawer, recent conversations, and text-in-chat quiz behavior.
- Replaced Bubble's client/API-connector OpenAI pattern with a server-only `/api/chat` stream route. `OPENAI_API_KEY` is only read from environment variables.
- Replaced the hard-coded Bubble admin check with `ADMIN_EMAILS`.
- Added a Google profile-photo cache that fetches the current Google avatar server-side at login and updates the stored image only when the content hash changes.
- The provided CSV export does not include Bubble Unique ID columns for all objects. Production import therefore supports `strict` mode, which fails until those columns are supplied, and `best-effort` mode, which imports reconstructable users/topics/messages plus legacy snapshots.
- Historical ownership cannot be perfectly reconstructed from the current CSVs because user rows lack Bubble user IDs and chat rows lack chat IDs. Imported legacy chats/messages are preserved for audit and recovery, while new runtime chats are owned by authenticated users.
- Legal and mission pages use text extracted from the Bubble export rather than newly written legal copy. Some Bubble layout ordering is simplified into readable sections.
