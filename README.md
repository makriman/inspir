# inspir

**"The Only Study Toolkit You Need"**

inspir is an all-in-one AI-powered study platform designed to help students succeed. With **15 live tools** and comprehensive features, inspir combines cutting-edge AI technology with essential study utilities to create the ultimate academic companion.

[![Live Site](https://img.shields.io/badge/Live-quiz.inspir.uk-blue)](https://quiz.inspir.uk)
[![License](https://img.shields.io/badge/License-Private-red)]()

---

## 🚀 Live Tools (15)

### 1. 📝 Quiz Generator
Upload PDFs, DOCX files, or paste text to generate AI-powered quizzes instantly. Get 10 intelligent questions with automatic grading and detailed explanations.

**Features:**
- Multiple input methods (file upload or text paste)
- Mixed question types (multiple choice & short answer)
- AI-powered grading with Claude Sonnet 4.5
- Quiz sharing with unique tokens
- Guest quiz-taking (no login required)
- Analytics dashboard with attempt tracking
- Quiz history and progress tracking
- Instant feedback and explanations

### 2. ⏱️ Study Timer
Focus-optimized Pomodoro timer with customizable intervals and break periods.

**Features:**
- Customizable work/break intervals
- Audio notifications
- Session tracking
- Focus mode
- Progress statistics

### 3. 🎓 Grade Calculator
Plan your semester with precision. Calculate current grades, predict final scores, and strategize your study efforts.

**Features:**
- Multiple assignment types
- Weight-based calculations
- What-if scenarios
- Grade prediction
- Semester planning

### 4. 💭 Student Forum
Connect with fellow students, share resources, ask questions, and build your study community.

**Features:**
- Topic-based discussions
- Real-time posts
- Community Q&A
- Resource sharing
- Study groups

### 5. 📚 Citation Generator
Generate properly formatted citations in multiple styles (APA, MLA, Chicago, Harvard) from URLs, books, or journals.

**Features:**
- Multiple citation styles (APA, MLA, Chicago, Harvard)
- URL-based citation generation
- Book and journal citations
- Copy to clipboard
- Citation history tracking
- Automatic metadata extraction

### 6. 📝 Cornell Notes
Take structured notes using the proven Cornell note-taking system with AI-powered features.

**Features:**
- Cornell note-taking format (Cues, Notes, Summary)
- Auto-save functionality
- Export to PDF
- Rich text editing
- Note organization and search
- Template system

### 7. 🔥 Study Streaks
Track your daily study activity and build consistent study habits with gamified streak tracking.

**Features:**
- Daily streak counter
- 30-day activity heatmap calendar
- Activity breakdown by type (quiz, timer, notes, citations, doubt solver)
- Longest streak tracking
- Total study days counter
- Motivational tips and progress visualization

### 8. 🤔 Doubt Solver
Get instant help with your doubts and questions using AI-powered problem solving.

**Features:**
- AI-powered doubt resolution
- Step-by-step explanations
- Multi-subject support
- Image upload for problems
- Solution history
- Follow-up questions
- Shareable solutions

### 9. 📄 Text Summarizer
Condense long texts, articles, and documents into concise summaries using AI.

**Features:**
- Upload documents (PDF, DOCX, TXT) or paste text
- AI-powered summarization
- Adjustable summary length
- Key points extraction
- Multiple summary formats

### 10. 📖 Study Guide Generator
Create comprehensive study guides from your course materials automatically.

**Features:**
- Generate from documents or text
- Structured study guide format
- Key concepts and definitions
- Practice questions included
- Export to PDF

### 11. 🎴 Flashcard Creator
Generate smart flashcards from your study materials with AI assistance.

**Features:**
- Auto-generate from text or documents
- Spaced repetition algorithm
- Interactive study mode
- Progress tracking
- Export and share flashcard sets

### 12. 🔢 Math Solver
Solve mathematical problems with step-by-step explanations.

**Features:**
- Multiple math topics supported
- Step-by-step solutions
- Visual explanations
- Image upload for handwritten problems
- Solution history

### 13. 🧠 Mind Map Creator
Visualize concepts and relationships with interactive mind maps.

**Features:**
- AI-assisted mind map generation
- Interactive node creation
- Export to image
- Collaborative features
- Custom styling and colors

### 14. 🗺️ Concept Map Builder
Build detailed concept maps to understand relationships between ideas.

**Features:**
- AI-powered concept extraction
- Interactive graph visualization
- Relationship mapping
- Export and share
- Template library

### 15. 📋 Practice Test Builder
Create full practice tests from your study materials.

**Features:**
- Generate from documents or topics
- Multiple question types
- Timed test mode
- Auto-grading with feedback
- Performance analytics

---

## 🛠️ Tech Stack

### Frontend
- **React 19** - Modern UI framework
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first styling
- **React Router DOM** - Client-side routing
- **Framer Motion** - Animation library
- **Supabase Client** - Authentication & database
- **Axios** - HTTP client
- **React Markdown** - Markdown rendering with KaTeX
- **Lucide React** - Icon library
- **React Flow** - Interactive diagrams

### Backend
- **Node.js & Express 5** - Server framework
- **Anthropic Claude API** - AI/ML (Sonnet 4.5)
- **Supabase** - Auth, database & real-time features
- **Multer** - File upload handling
- **pdf-parse & mammoth** - Document processing (PDF, DOCX)
- **JWT** - Secure authentication
- **Bcrypt** - Password hashing

### Infrastructure
- **nginx** - Reverse proxy & static serving
- **PM2** - Process management
- **Certbot** - SSL/TLS certificates
- **Ubuntu Server** - Production hosting

---

## 📦 Installation & Setup

### Prerequisites

- Node.js 18+ installed
- A Supabase account ([supabase.com](https://supabase.com))
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

### 1. Clone the Repository

```bash
git clone https://github.com/makriman/inspir.git
cd inspir/quiz-app
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run all migration files:
   - `backend/database-schema.sql`
   - `backend/database-migration-sharing.sql`
   - `backend/database-new-features.sql`
   - Other schema files as needed
3. Get your project URL and keys from Settings > API

### 3. Backend Setup

```bash
cd backend

# Copy environment template
cp .env.example .env

# Edit .env and add your credentials:
# - ANTHROPIC_API_KEY (from console.anthropic.com)
# - SUPABASE_URL (from Supabase project settings)
# - SUPABASE_KEY (service role key from Supabase)
# - JWT_SECRET (generate a secure random string)
# - FRONTEND_URL (e.g., http://localhost:5173)

# Install dependencies
npm install

# Start the backend server
npm run dev
```

The backend will run on `http://localhost:5000`

### 4. Frontend Setup

```bash
cd ../frontend

# Copy environment template
cp .env.example .env

# Edit .env and add:
# - VITE_SUPABASE_URL (same as backend)
# - VITE_SUPABASE_ANON_KEY (anon key from Supabase)
# - VITE_API_URL=http://localhost:5000

# Install dependencies
npm install

# Start the frontend dev server
npm run dev
```

The frontend will run on `http://localhost:5173`

### 5. Open the App

Navigate to `http://localhost:5173` in your browser.

---

## 🏗️ Project Structure

```
inspir/
├── quiz-app/
│   ├── backend/                    # Node.js/Express backend
│   │   ├── controllers/           # API controllers for each feature
│   │   │   ├── quizController.js
│   │   │   ├── doubtController.js
│   │   │   ├── flashcardController.js
│   │   │   ├── mathSolverController.js
│   │   │   ├── summarizerController.js
│   │   │   └── ... (more)
│   │   ├── routes/                # API route handlers
│   │   ├── middleware/            # Auth & validation middleware
│   │   ├── utils/                 # Helper functions
│   │   ├── uploads/               # File upload directory
│   │   ├── database-*.sql         # Database schemas & migrations
│   │   ├── server.js              # Main server file
│   │   └── .env.example           # Environment template
│   │
│   └── frontend/                   # React frontend
│       ├── src/
│       │   ├── components/        # Reusable UI components
│       │   ├── pages/             # Route pages (15 tools)
│       │   ├── contexts/          # React contexts (Auth, etc.)
│       │   ├── seo/               # SEO configuration
│       │   ├── utils/             # Helper functions
│       │   ├── App.jsx            # Main app component
│       │   └── main.jsx           # Entry point
│       ├── public/                # Static assets
│       └── .env.example           # Environment template
│
├── deploy/                         # Deployment configs
│   ├── nginx/                     # nginx configuration
│   └── systemd/                   # systemd service files
│
├── docs/                           # Additional documentation
└── README.md                       # You are here
```

---

## 🚀 Deployment

### Production Build

**Frontend:**
```bash
cd quiz-app/frontend
npm run build
```

**Backend:**
```bash
cd quiz-app/backend
npm start
```

### Server Deployment (Ubuntu + nginx)

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment instructions including:
- Server setup
- nginx configuration
- SSL/TLS with Certbot
- PM2 process management
- Environment configuration

---

## 📖 API Documentation

### Quiz Routes
- `POST /api/quiz/generate` - Generate quiz from content
- `POST /api/quiz/save` - Save quiz to database
- `POST /api/quiz/submit` - Submit quiz answers for grading
- `GET /api/quiz/user` - Get user's quizzes (auth required)
- `GET /api/quiz/:id` - Get specific quiz by ID
- `DELETE /api/quiz/:id` - Delete quiz
- `POST /api/quiz/:quizId/share` - Generate share token
- `GET /api/quiz/shared/:shareToken` - Get shared quiz (public)
- `POST /api/quiz/shared/:shareToken/submit` - Submit shared quiz attempt
- `GET /api/quiz/:quizId/attempts` - Get quiz attempt statistics

### Citation Routes
- `POST /api/citations/generate` - Generate citation from URL or metadata
- `GET /api/citations/history` - Get citation history (auth required)

### Cornell Notes Routes
- `POST /api/cornell-notes` - Create new Cornell note
- `GET /api/cornell-notes` - Get all user's notes (auth required)
- `GET /api/cornell-notes/:id` - Get specific note
- `PUT /api/cornell-notes/:id` - Update note
- `DELETE /api/cornell-notes/:id` - Delete note

### Study Streaks Routes
- `POST /api/streaks/activity` - Log study activity
- `GET /api/streaks/current` - Get current streak data (auth required)
- `GET /api/streaks/history` - Get activity history (auth required)
- `GET /api/streaks/stats` - Get activity statistics (auth required)

### Doubt Solver Routes
- `POST /api/doubt` - Submit doubt for AI resolution
- `POST /api/doubt/share` - Generate shareable doubt solution

### Text Summarizer Routes
- `POST /api/summarizer/summarize` - Generate text summary

### Study Guide Routes
- `POST /api/study-guide/generate` - Generate study guide

### Flashcard Routes
- `POST /api/flashcards/generate` - Generate flashcard set
- `GET /api/flashcards` - Get user's flashcard sets
- `PUT /api/flashcards/:id` - Update flashcard set
- `DELETE /api/flashcards/:id` - Delete flashcard set

### Math Solver Routes
- `POST /api/math/solve` - Solve math problem with steps

### Mind Map Routes
- `POST /api/mind-map/generate` - Generate mind map

### Concept Map Routes
- `POST /api/concept-map/generate` - Generate concept map

### Practice Test Routes
- `POST /api/practice-test/generate` - Generate practice test
- `POST /api/practice-test/submit` - Submit and grade practice test

### Auth Routes
- `POST /api/auth/signup` - Create new account
- `POST /api/auth/login` - Sign in
- `POST /api/auth/logout` - Sign out
- `POST /api/auth/reset-password` - Request password reset
- `GET /api/auth/me` - Get current user (auth required)

### Forum Routes
- `GET /api/forum/posts` - Get all forum posts
- `POST /api/forum/posts` - Create new post (auth required)
- `GET /api/forum/posts/:id` - Get specific post
- `POST /api/forum/posts/:id/comments` - Add comment (auth required)

---

## 🗄️ Database Schema

### Core Tables

**users** (managed by Supabase Auth)
- Authentication and user profiles

**quizzes**
- `id` (UUID, primary key)
- `user_id` (UUID, foreign key)
- `source_name` (TEXT)
- `questions` (JSONB)
- `share_token` (TEXT, unique)
- `is_shared` (BOOLEAN)
- `created_by_username` (TEXT)
- `created_at` (TIMESTAMP)

**quiz_results**
- `id` (UUID, primary key)
- `user_id` (UUID, foreign key)
- `quiz_id` (UUID, foreign key)
- `score` (INTEGER)
- `total_questions` (INTEGER)
- `percentage` (INTEGER)
- `answers` (JSONB)
- `submitted_at` (TIMESTAMP)

**quiz_attempts**
- `id` (UUID, primary key)
- `quiz_id` (UUID, foreign key)
- `user_id` (UUID, nullable)
- `attempt_name` (TEXT)
- `is_guest` (BOOLEAN)
- `score`, `total_questions`, `percentage`
- `answers` (JSONB)
- `completed_at` (TIMESTAMP)

**forum_posts** & **forum_comments**
- Community forum content

**cornell_notes**
- Structured Cornell notes

**study_activity** & **user_streaks**
- Study tracking and gamification

**flashcard_sets** & **flashcards**
- Flashcard content and progress

**doubt_solutions**
- Doubt solver history

**text_summaries**
- Summarizer history

**math_solutions**
- Math solver history

**study_guides**
- Generated study guides

**mind_maps** & **concept_maps**
- Visual learning tools

**practice_tests**
- Practice test history

---

## 🎨 Brand Colors

- **Deep Blue** (#1A237E) - Primary brand color
- **Vibrant Purple** (#7C3AED) - Accents and highlights
- **Coral Red** (#FF5252) - Call-to-action buttons
- **Vibrant Yellow** (#FFC107) - Secondary buttons
- **Off-White** (#F9FAFB) - Backgrounds and cards
- **Purple Gradient** - Main page backgrounds

---

## 🤝 Contributing

This is a private project. If you have access and want to contribute:

1. Create a feature branch: `git checkout -b feature/amazing-feature`
2. Commit your changes: `git commit -m 'Add amazing feature'`
3. Push to the branch: `git push origin feature/amazing-feature`
4. Open a Pull Request

---

## 🔒 Security

- Never commit `.env` files
- Keep API keys and secrets secure
- Report security vulnerabilities to the project maintainers
- Use strong JWT secrets in production
- Enable HTTPS in production
- Keep dependencies updated
- Rate limiting enabled on API endpoints
- Row Level Security (RLS) policies in Supabase

---

## 📝 License

**Private / All Rights Reserved**

This is a private project. All rights reserved. Unauthorized copying, modification, distribution, or use of this software is strictly prohibited.

---

## 🆘 Support & Issues

For issues, feature requests, or questions:
- Create an issue on GitHub
- Check existing documentation
- Review the FAQ page at [quiz.inspir.uk/faq](https://quiz.inspir.uk/faq)

---

## 🙏 Acknowledgments

- Powered by [Anthropic Claude AI](https://www.anthropic.com) (Sonnet 4.5)
- Database & Auth by [Supabase](https://supabase.com)
- Deployed on Ubuntu Server with nginx
- Built with ❤️ for students everywhere

---

**inspir** - The Only Study Toolkit You Need

*Comprehensive AI-powered study platform with 15 live tools to help you succeed.*
