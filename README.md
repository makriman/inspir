# InspirQuiz

> AI-powered quiz generation platform that creates personalized quizzes from any topic, text, or document.

InspirQuiz is a full-stack web application that leverages Claude AI (Anthropic) to generate intelligent, contextual quizzes. Users can create quizzes from topics, uploaded files, or custom text, share them with others, and track performance analytics.

## Features

### Core Functionality
- **AI-Powered Quiz Generation**: Generate quizzes from topics, documents (PDF, DOCX, TXT), or custom text using Claude AI
- **Flexible Input Options**:
  - Simple topic-based generation ("World War II", "JavaScript closures")
  - File upload support (PDF, DOCX, TXT)
  - Custom text input for specific content
- **Multiple Question Types**: Multiple choice and short answer questions
- **Intelligent Grading**: AI-powered answer evaluation with detailed feedback

### Social Features
- **Quiz Sharing**: Share quizzes via unique links (WhatsApp, Email, direct link)
- **Guest Access**: No login required for taking shared quizzes
- **Analytics Dashboard**: Track attempts, scores, and performance statistics
- **Attempt History**: View detailed answers and responses from quiz takers

### User Experience
- **Responsive Design**: Mobile-first approach, works seamlessly on all devices
- **Modern UI**: Built with Tailwind CSS and Framer Motion animations
- **Progress Tracking**: Visual progress indicators during quiz-taking
- **Real-time Feedback**: Instant results with detailed explanations

## Tech Stack

### Frontend
- **React 19** - UI framework
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first CSS framework
- **Framer Motion** - Animation library
- **Axios** - HTTP client
- **React Markdown** - Markdown rendering with KaTeX support
- **Lucide React** - Icon library

### Backend
- **Node.js** - Runtime environment
- **Express 5** - Web framework
- **Supabase** - Database and authentication
- **Anthropic Claude API** - AI-powered quiz generation and grading
- **JWT** - Token-based authentication
- **Multer** - File upload handling
- **Bcrypt** - Password hashing

### Infrastructure
- **PostgreSQL** (via Supabase) - Relational database
- **Row Level Security** - Database-level access control
- **Rate Limiting** - API protection

## Project Structure

```
/root
├── quiz-app/
│   ├── backend/
│   │   ├── controllers/
│   │   │   ├── authController.js
│   │   │   ├── quizController.js
│   │   │   └── gradeController.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── quiz.js
│   │   │   └── grade.js
│   │   ├── middleware/
│   │   │   └── auth.js
│   │   ├── uploads/
│   │   ├── database-migration-sharing.sql
│   │   ├── server.js
│   │   └── package.json
│   │
│   └── frontend/
│       ├── src/
│       │   ├── components/
│       │   │   ├── Quiz.jsx
│       │   │   ├── Results.jsx
│       │   │   ├── SharedQuiz.jsx
│       │   │   ├── QuizAttempts.jsx
│       │   │   ├── UploadInterface.jsx
│       │   │   └── ...
│       │   ├── pages/
│       │   │   ├── Home.jsx
│       │   │   ├── Dashboard.jsx
│       │   │   ├── FAQ.jsx
│       │   │   └── ...
│       │   ├── App.jsx
│       │   └── main.jsx
│       ├── public/
│       ├── index.html
│       └── package.json
│
├── frontend/ (separate frontend instance)
└── install.sh
```

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Supabase account
- Anthropic API key

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd root
   ```

2. **Set up the backend**
   ```bash
   cd quiz-app/backend
   npm install
   ```

3. **Configure backend environment variables**

   Create `.env` file in `quiz-app/backend/`:
   ```env
   PORT=5000
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_key
   JWT_SECRET=your_jwt_secret
   ANTHROPIC_API_KEY=your_anthropic_api_key
   FRONTEND_URL=http://localhost:5173
   ```

4. **Set up the database**

   Run the migration SQL in your Supabase SQL Editor:
   ```bash
   # File: quiz-app/backend/database-migration-sharing.sql
   ```

5. **Set up the frontend**
   ```bash
   cd ../frontend
   npm install
   ```

6. **Configure frontend environment variables**

   Create `.env` file in `quiz-app/frontend/`:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_API_URL=http://localhost:5000
   ```

7. **Start the development servers**

   Backend:
   ```bash
   cd quiz-app/backend
   npm run dev
   ```

   Frontend (in a new terminal):
   ```bash
   cd quiz-app/frontend
   npm run dev
   ```

8. **Access the application**

   Open your browser and navigate to `http://localhost:5173`

## Database Schema

### Tables

#### `users`
- User authentication and profile information
- Fields: id, username, email, password_hash, created_at

#### `quizzes`
- Stores generated quizzes
- Fields: id, user_id, source_name, questions, share_token, is_shared, created_by_username, created_at

#### `quiz_results`
- Legacy table for quiz results
- Fields: id, quiz_id, user_id, score, total_questions, percentage, answers, submitted_at

#### `quiz_attempts`
- Modern table tracking all quiz attempts (guests and users)
- Fields: id, quiz_id, user_id, attempt_name, is_guest, score, total_questions, percentage, answers, completed_at

### Key Features
- **Row Level Security (RLS)** policies for secure data access
- **UUID-based share tokens** for secure quiz sharing
- **Helper functions** for share token generation and statistics

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create new user account
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user info

### Quiz Management
- `POST /api/quiz/generate` - Generate quiz from topic/text/file
- `POST /api/quiz/save` - Save quiz to database
- `POST /api/quiz/submit` - Submit quiz answers
- `GET /api/quiz/user` - Get user's quizzes
- `GET /api/quiz/:quizId` - Get specific quiz
- `DELETE /api/quiz/:quizId` - Delete quiz

### Quiz Sharing
- `POST /api/quiz/:quizId/share` - Generate share token
- `GET /api/quiz/shared/:shareToken` - Get shared quiz (public)
- `POST /api/quiz/shared/:shareToken/submit` - Submit shared quiz attempt (public)
- `GET /api/quiz/:quizId/attempts` - Get quiz attempt statistics

### Grading
- `POST /api/grade/question` - Grade a single question
- `POST /api/grade/quiz` - Grade entire quiz

## Environment Variables

### Backend (.env)
```env
PORT=5000
SUPABASE_URL=<your_supabase_project_url>
SUPABASE_KEY=<your_supabase_service_role_key>
JWT_SECRET=<random_secure_string>
ANTHROPIC_API_KEY=<your_anthropic_api_key>
FRONTEND_URL=http://localhost:5173
```

### Frontend (.env)
```env
VITE_SUPABASE_URL=<your_supabase_project_url>
VITE_SUPABASE_ANON_KEY=<your_supabase_anon_key>
VITE_API_URL=http://localhost:5000
```

## Deployment

### Backend Deployment
1. Set production environment variables
2. Update `FRONTEND_URL` to production domain
3. Deploy to your hosting platform (Heroku, Railway, Render, etc.)
4. Run database migrations in Supabase

### Frontend Deployment
1. Update `VITE_API_URL` to production backend URL
2. Build the application:
   ```bash
   npm run build
   ```
3. Deploy the `dist/` folder to your hosting platform (Vercel, Netlify, etc.)

### Database Migration
Run the SQL migration file in your Supabase SQL Editor:
```sql
-- File: quiz-app/backend/database-migration-sharing.sql
```

## Features in Detail

### Quiz Generation
The application uses Claude AI to generate contextual quizzes from:
1. **Topics**: Simple text topics (e.g., "Python programming")
2. **Files**: Upload PDF, DOCX, or TXT files
3. **Custom Text**: Paste any text content

### Quiz Sharing Workflow
1. User creates and completes a quiz
2. Clicks "Share This Quiz" button
3. System generates unique share token
4. User copies link or shares via WhatsApp/Email
5. Recipients can take quiz without login (as guest)
6. Quiz creator can view all attempts and statistics

### Guest Quiz Taking
1. Guest opens shared link
2. Enters their name (no account required)
3. Takes the quiz
4. Views results with signup CTA
5. Attempt is saved and visible to quiz creator

### Analytics Dashboard
Quiz creators can view:
- Total number of attempts
- Average score and percentage
- Highest and lowest scores
- Detailed list of all attempts
- Individual answers for each attempt
- Search and sort functionality

## Security Features

- **JWT Authentication**: Secure token-based auth
- **Row Level Security**: Database-level access control
- **Input Validation**: Server-side validation for all inputs
- **Rate Limiting**: API endpoint protection
- **XSS Protection**: React's built-in escaping
- **HTTPS**: Enforced in production
- **Environment Variables**: Sensitive data kept out of code

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License.

## Acknowledgments

- **Anthropic Claude AI** - Quiz generation and grading
- **Supabase** - Backend infrastructure
- **Tailwind CSS** - UI styling
- **React** - Frontend framework

## Support

For issues, questions, or contributions, please open an issue on GitHub.

---

Built with Claude AI by Anthropic
