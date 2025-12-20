# inspir

**"The Only Study Toolkit You Need"**

inspir is an all-in-one AI-powered study platform designed to help students succeed. With 8 live tools and 59 more coming soon, inspir combines cutting-edge AI technology with essential study utilities to create the ultimate academic companion.

[![Live Site](https://img.shields.io/badge/Live-quiz.inspir.uk-blue)](https://quiz.inspir.uk)
[![License](https://img.shields.io/badge/License-Private-red)]()

---

## 🚀 Live Tools (8)

### 1. 📝 Quiz Generator
Upload PDFs, DOCX files, or paste text to generate AI-powered quizzes instantly. Get 10 intelligent questions with automatic grading and detailed explanations.

**Features:**
- Multiple input methods (file upload or text paste)
- Mixed question types (multiple choice & short answer)
- AI-powered grading with Claude 4.5
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

---

## 🔮 Coming Soon (59 Tools)

inspir is rapidly expanding with 58 additional study tools in development, including:
- Flashcard generator
- Mind mapping tool
- Study planner & calendar
- Concept mapper
- Math equation solver
- And 53 more...

---

## 🛠️ Tech Stack

### Frontend
- **React 18** - Modern UI framework
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first styling
- **React Router DOM** - Client-side routing
- **Supabase Client** - Authentication & database
- **Axios** - HTTP client

### Backend
- **Node.js & Express** - Server framework
- **Anthropic Claude API** - AI/ML (Sonnet 4.5)
- **Supabase** - Auth, database & real-time features
- **Multer** - File upload handling
- **pdf-parse & mammoth** - Document processing
- **JWT** - Secure authentication

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
cd inspir
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the schema from `backend/database-schema.sql`
3. Get your project URL and anon key from Settings > API

### 3. Backend Setup

```bash
cd backend

# Copy environment template
cp .env.example .env

# Edit .env and add your credentials:
# - ANTHROPIC_API_KEY (from console.anthropic.com)
# - SUPABASE_URL (from Supabase project settings)
# - SUPABASE_ANON_KEY (from Supabase project settings)
# - JWT_SECRET (generate a secure random string)

# Install dependencies
npm install

# Start the backend server
npm run dev
```

The backend will run on `http://localhost:3000`

### 4. Frontend Setup

```bash
cd frontend

# Copy environment template
cp .env.example .env

# Edit .env and add:
# - VITE_SUPABASE_URL (same as backend)
# - VITE_SUPABASE_ANON_KEY (same as backend)
# - VITE_API_URL=http://localhost:3000/api

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
├── backend/                 # Node.js/Express backend
│   ├── routes/             # API route handlers
│   ├── middleware/         # Auth & validation middleware
│   ├── utils/              # Helper functions
│   ├── uploads/            # File upload directory
│   ├── database-schema.sql # Supabase database schema
│   ├── server.js           # Main server file
│   └── .env.example        # Environment template
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Route pages
│   │   ├── contexts/      # React contexts (Auth, etc.)
│   │   ├── utils/         # Helper functions
│   │   ├── App.jsx        # Main app component
│   │   └── main.jsx       # Entry point
│   ├── public/            # Static assets
│   └── .env.example       # Environment template
├── deploy/                 # Deployment configs
│   ├── nginx/             # nginx configuration
│   └── systemd/           # systemd service files
├── docs/                   # Additional documentation
└── README.md              # You are here
```

---

## 🚀 Deployment

### Production Build

**Frontend:**
```bash
cd frontend
npm run build
```

**Backend:**
```bash
cd backend
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
- `POST /api/quiz/submit` - Submit quiz answers for grading
- `GET /api/quiz/history` - Get user's quiz history (auth required)
- `GET /api/quiz/:id` - Get specific quiz by ID

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

### Tables

**quizzes**
- `id` (UUID, primary key)
- `user_id` (UUID, foreign key to auth.users)
- `source_name` (TEXT)
- `questions` (JSONB)
- `created_at` (TIMESTAMP)

**quiz_results**
- `id` (UUID, primary key)
- `user_id` (UUID, foreign key to auth.users)
- `quiz_id` (UUID, foreign key to quizzes)
- `score` (INTEGER)
- `total_questions` (INTEGER)
- `percentage` (INTEGER)
- `answers` (JSONB)
- `submitted_at` (TIMESTAMP)

**forum_posts**
- `id` (UUID, primary key)
- `user_id` (UUID, foreign key to auth.users)
- `title` (TEXT)
- `content` (TEXT)
- `category` (TEXT)
- `created_at` (TIMESTAMP)

**forum_comments**
- `id` (UUID, primary key)
- `post_id` (UUID, foreign key to forum_posts)
- `user_id` (UUID, foreign key to auth.users)
- `content` (TEXT)
- `created_at` (TIMESTAMP)

**cornell_notes**
- `id` (UUID, primary key)
- `user_id` (UUID, foreign key to auth.users)
- `title` (TEXT)
- `cues` (TEXT)
- `notes` (TEXT)
- `summary` (TEXT)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

**study_activity**
- `id` (UUID, primary key)
- `user_id` (UUID, foreign key to auth.users)
- `activity_date` (DATE)
- `activity_type` (VARCHAR) - 'quiz', 'chat', 'timer', 'notes', 'citation'
- `activity_count` (INTEGER)
- `total_time_minutes` (INTEGER)

**user_streaks**
- `user_id` (UUID, primary key)
- `current_streak` (INTEGER)
- `longest_streak` (INTEGER)
- `total_study_days` (INTEGER)
- `last_activity_date` (DATE)
- `streak_freeze_count` (INTEGER)

---

## 🎨 Brand Colors

- **Deep Blue** (#1A237E) - Primary brand color
- **Vibrant Yellow-Green** (#C6FF00) - Accent highlights
- **Coral Red** (#FF5252) - Call-to-action buttons
- **Off-White** (#F5F5F5) - Backgrounds and cards
- **Purple Gradient** (#6A1B9A → #4A148C) - Main backgrounds

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

- Powered by [Anthropic Claude AI](https://www.anthropic.com)
- Database & Auth by [Supabase](https://supabase.com)
- Deployed on Ubuntu Server with nginx
- Built with ❤️ for students everywhere

---

**inspir** - The Only Study Toolkit You Need
