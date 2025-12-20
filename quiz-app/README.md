# quiz-app (production)

This is the app that `deploy.sh` builds and ships to `https://quiz.inspir.uk`.

## Live Tools

The site currently exposes **50 live tools** (and additional coming-soon tool pages).
Browse the full tool list in the UI: `https://quiz.inspir.uk`.

## Local Development

### Backend
```bash
cd quiz-app/backend
cp .env.example .env
npm install
npm run dev
```

### Frontend
```bash
cd quiz-app/frontend
cp .env.example .env
npm install
npm run dev
```

## Database (Supabase)

Some newer tools require schema scripts to be applied in the Supabase SQL editor:

- `quiz-app/backend/database-focus-tools.sql`
- `quiz-app/backend/database-next-15-tools.sql`

