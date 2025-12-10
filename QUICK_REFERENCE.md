# QuizMaster - Quick Reference

## Brand Colors (Tailwind Classes)

```css
bg-deep-blue         /* #1A237E - Primary brand */
bg-vibrant-yellow    /* #C6FF00 - Accent/highlights */
bg-coral-red         /* #FF5252 - CTA buttons */
bg-off-white         /* #F5F5F5 - Backgrounds */
bg-purple-gradient   /* #6A1B9A → #4A148C - Main bg */
```

## Environment Variables

### Backend (.env)
```bash
PORT=3000
HOST=0.0.0.0
FRONTEND_URL=https://quiz.inspir.uk
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
```

### Frontend (.env)
```bash
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
VITE_API_URL=http://localhost:3000/api
```

## Common Commands

### Development
```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev
```

### Build
```bash
# Backend
cd backend && npm start

# Frontend
cd frontend && npm run build
```

## API Quick Reference

### Generate Quiz
```javascript
POST /api/quiz/generate
Headers: Authorization: Bearer <token> (optional)
Body: FormData {
  file: File (optional)
  content: String (optional)
  sourceName: String
}
Response: {
  quizId: UUID,
  questions: Array<Question>
}
```

### Submit Quiz
```javascript
POST /api/quiz/submit
Headers: Authorization: Bearer <token> (optional)
Body: {
  quizId: UUID,
  questions: Array<Question>,
  answers: Array<String>
}
Response: {
  score: Number,
  totalQuestions: Number,
  percentage: Number,
  results: Array<Result>
}
```

### Get History
```javascript
GET /api/quiz/history
Headers: Authorization: Bearer <token> (required)
Response: Array<QuizResult>
```

## Component Props

### Login/Signup
```jsx
<Login onToggle={() => setIsLogin(false)} />
<Signup onToggle={() => setIsLogin(true)} />
```

### ProtectedRoute
```jsx
<ProtectedRoute>
  <Dashboard />
</ProtectedRoute>
```

## Supabase Database Quick Access

### View All Quizzes
```sql
SELECT * FROM quizzes ORDER BY created_at DESC;
```

### View Quiz Results
```sql
SELECT qr.*, q.source_name
FROM quiz_results qr
LEFT JOIN quizzes q ON qr.quiz_id = q.id
ORDER BY qr.submitted_at DESC;
```

### User Stats
```sql
SELECT
  user_id,
  COUNT(*) as total_quizzes,
  ROUND(AVG(percentage)) as avg_score,
  MAX(percentage) as best_score
FROM quiz_results
GROUP BY user_id;
```

## File Upload Limits

- **Supported formats**: PDF, DOCX, DOC, TXT
- **Max size**: 10MB
- **Min text**: 100 characters
- **Storage**: backend/uploads/ (temporary)

## Routes

### Frontend
- `/` - Home (Upload Interface)
- `/auth` - Login/Signup
- `/quiz` - Take Quiz
- `/results` - View Results
- `/dashboard` - Quiz History (protected)

### Backend
- `/api/health` - Health check
- `/api/quiz/*` - Quiz operations
- `/api/auth/*` - Authentication

## Useful Code Snippets

### Add Custom Brand Color
```javascript
// tailwind.config.js
colors: {
  'custom-color': '#HEXCODE',
}
```

### Get Current User
```javascript
const { user, session } = useAuth();
```

### Protected API Call
```javascript
const response = await axios.get(url, {
  headers: {
    Authorization: `Bearer ${session.access_token}`
  }
});
```

## Troubleshooting Quick Fixes

### Port already in use
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Kill process on port 5173
lsof -ti:5173 | xargs kill -9
```

### Clear npm cache
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Reset Supabase auth
```sql
-- In Supabase SQL Editor
TRUNCATE auth.users CASCADE;
```

### Check Claude API quota
```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01"
```

## Testing Checklist

- [ ] Upload PDF file
- [ ] Upload DOCX file
- [ ] Paste text content
- [ ] Generate quiz
- [ ] Answer all questions
- [ ] Submit quiz
- [ ] View results
- [ ] Sign up new user
- [ ] Sign in existing user
- [ ] View dashboard
- [ ] Check quiz history
- [ ] Test sorting options
- [ ] Sign out

## Performance Metrics

- Quiz generation: 10-30 seconds
- Quiz submission: 5-15 seconds (depends on short answers)
- Page load: <2 seconds
- File upload: ~1 second per MB

## Support Resources

- [Supabase Docs](https://supabase.com/docs)
- [Anthropic API Docs](https://docs.anthropic.com)
- [React Docs](https://react.dev)
- [Tailwind Docs](https://tailwindcss.com)
- [Vite Docs](https://vitejs.dev)

---

Keep this file handy for quick reference during development!
