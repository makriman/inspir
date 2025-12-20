# inspir

The only study toolkit you need — an AI-powered web app for quizzes, notes, summaries, and exam prep.

[![Live Site](https://img.shields.io/badge/Live-quiz.inspir.uk-blue)](https://quiz.inspir.uk)

---

## What’s Included

**Live tools (15)**
- 📝 Quiz Generator
- ⏱️ Study Timer
- 🎓 Grade Calculator
- 💭 Student Forum
- 📚 Citation Generator
- 📝 Cornell Notes
- 🔥 Study Streaks
- 🤔 Doubt Solver
- 📄 Text Summarizer
- 📖 Study Guide Generator
- 🎴 Flashcard Creator
- 🔢 Math Solver
- 🧠 Mind Map Creator
- 🗺️ Concept Map Builder
- 📋 Practice Test Builder

**Core capabilities**
- Auth + user data via Supabase
- File and text inputs (PDF/DOCX/TXT + pasted text)
- Share links for quizzes and doubt solutions
- SEO prerendering for marketing/blog pages

---

## Tech Stack

- Frontend: React + Vite + Tailwind
- Backend: Node.js + Express
- AI: Anthropic Claude (API)
- Auth/DB: Supabase

---

## Local Development

### Prerequisites
- Node.js 18+
- Supabase project (URL + anon key)
- Anthropic API key

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

---

## Deployment

See `docs/DEPLOYMENT.md` for Ubuntu + nginx + SSL + PM2/systemd instructions.

---

## Repo Layout

- `frontend/` React app
- `backend/` Express API
- `deploy/` nginx + systemd templates
- `docs/` operational docs

