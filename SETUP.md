# QuizMaster - Quick Setup Guide

Follow these steps to get your Quiz Generation app running locally.

## Prerequisites Checklist

- [ ] Node.js 18+ installed
- [ ] Supabase account created
- [ ] Anthropic API key obtained

## Step-by-Step Setup

### 1. Supabase Configuration

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to finish setting up (1-2 minutes)
3. Go to **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy and paste the contents of `backend/database-schema.sql`
6. Click **Run** to execute the SQL
7. Go to **Settings** > **API** and copy:
   - Project URL
   - anon/public key

### 2. Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Go to **API Keys**
4. Click **Create Key**
5. Copy your API key (you won't see it again!)

### 3. Backend Configuration

```bash
cd backend

# Create environment file
cp .env.example .env

# Edit .env file with your credentials:
# ANTHROPIC_API_KEY=sk-ant-...
# SUPABASE_URL=https://xxxxx.supabase.co
# SUPABASE_ANON_KEY=eyJhbGc...
# PORT=3000
# HOST=0.0.0.0
# FRONTEND_URL=https://quiz.inspir.uk
```

### 4. Frontend Configuration

```bash
cd ../frontend

# Create environment file
cp .env.example .env

# Edit .env file:
# VITE_SUPABASE_URL=https://xxxxx.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJhbGc...
# VITE_API_URL=http://localhost:3000/api
```

### 5. Install Dependencies & Run

**Terminal 1 - Backend:**
```bash
cd backend
npm install
npm run dev
```

Wait until you see: "Server running on http://0.0.0.0:3000"

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Wait until you see: "Local: http://localhost:5173"

### 6. Open the App

Visit http://localhost:5173 in your browser

## Testing the App

1. **Create an Account**
   - Click "Sign In" in the top right
   - Click "Sign up"
   - Enter email, password, and name
   - You'll be logged in automatically

2. **Generate Your First Quiz**
   - Go back to the home page
   - Either:
     - Upload a PDF/DOCX/TXT file
     - Or paste text (at least 100 characters)
   - Click "Generate Quiz"
   - Wait 10-30 seconds for AI to create questions

3. **Take the Quiz**
   - Answer the 10 questions
   - Navigate with Next/Previous buttons
   - Click "Submit Quiz" when done

4. **View Results**
   - See your score and percentage
   - Review correct/incorrect answers
   - Click "View History" to see all past quizzes

## Troubleshooting

### Backend won't start
- Check that port 3000 is not in use
- Verify all .env variables are set
- Check Node.js version: `node --version` (should be 18+)

### Frontend won't start
- Check that port 5173 is not in use
- Verify .env variables are set correctly
- Clear browser cache

### "Failed to generate quiz"
- Check ANTHROPIC_API_KEY is valid
- Ensure you have API credits
- Check backend terminal for error messages

### Authentication errors
- Verify Supabase credentials are correct
- Check that database schema was created successfully
- Ensure Supabase project is active

### File upload fails
- Check file is PDF, DOCX, or TXT
- File must be under 10MB
- Verify backend/uploads directory exists

## Default Test Content

If you don't have a file handy, paste this sample text:

```
Photosynthesis is the process by which plants use sunlight, water, and carbon dioxide to produce oxygen and energy in the form of sugar. This process occurs in the chloroplasts of plant cells, specifically in structures called thylakoids. The light-dependent reactions occur in the thylakoid membrane, while the light-independent reactions (Calvin cycle) occur in the stroma. Chlorophyll, the green pigment in plants, absorbs light energy, primarily in the blue and red wavelengths. The overall chemical equation for photosynthesis is: 6CO2 + 6H2O + light energy → C6H12O6 + 6O2. This process is essential for life on Earth as it produces oxygen and serves as the foundation of most food chains.
```

## Next Steps

Once everything is working:
- Explore the Dashboard to see quiz history
- Try different types of content
- Customize the brand colors in `frontend/tailwind.config.js`
- Deploy to production (Vercel, Railway, etc.)

## Support

If you encounter issues:
1. Check this guide again
2. Review error messages in browser console and terminal
3. Verify all environment variables are set correctly
4. Check the main README.md for more details

Happy quizzing! 🎓
