# inspir

The only study toolkit you need — an AI-powered web app for quizzes, notes, summaries, and exam prep.

[![Live Site](https://img.shields.io/badge/Live-quiz.inspir.uk-blue)](https://quiz.inspir.uk)

---

## What's Included

**53 Live Study Tools** (see full list in-app: https://quiz.inspir.uk)

- **Active Learning:** Quiz Generator, Flashcard Creator, Practice Test Builder, Mind Map Creator, Concept Map Builder, Fill-in-the-Blank, MCQ Bank, True/False Quiz, Vocabulary Builder
- **AI Help:** Doubt Solver, Text Summarizer, Study Guide Generator, Math Solver, Citation Generator, Essay Assistant, Grammar Checker, Paraphrasing, Concept Explainer, Translator, Research Finder
- **Focus & Productivity:** Study Timer, Custom Timer, Task Timer, Break Reminder, Deep Work, Focus Mode, Focus Music, Ambient Sounds, Group Timer, Session Tracker
- **Gamification:** Study Streaks, Daily Goals, Habit Tracker, XP & Leveling, Badges, Leaderboards, Challenges, Milestones
- **Organization:** Cornell Notes, Grade Calculator, Note Organizer, Study Planner, Assignment Tracker, GPA Tracker, Course Manager, Schedule Builder
- **Analytics:** Progress Dashboard
- **Social:** Student Forum, Study Groups, Resource Sharing

**Core capabilities**
- Auth + user data via Supabase
- File and text inputs (PDF/DOCX/TXT + pasted text)
- Share links for quizzes and doubt solutions
- SEO prerendering for marketing/blog pages

**DB schema scripts (Supabase SQL editor)**
- `quiz-app/backend/database-focus-tools.sql` (focus + goals + analytics tools)
- `quiz-app/backend/database-next-15-tools.sql` (XP/badges/challenges + planner/courses + study groups/resources)

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
