import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import quizRoutes from './routes/quiz.js';
import authRoutes from './routes/auth.js';
import forumRoutes from './routes/forum.js';
import chatRoutes from './routes/chat.js';

dotenv.config();

// Guard against stdout/stderr EPIPE when the log sink closes unexpectedly (keeps server alive)
const handlePipeError = (err) => {
  if (err.code !== 'EPIPE') throw err;
};
process.stdout.on('error', handlePipeError);
process.stderr.on('error', handlePipeError);

// Validate critical environment variables
const requiredEnvVars = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('ERROR: Missing required environment variables:');
  missingEnvVars.forEach(varName => console.error(`  - ${varName}`));
  console.error('\nPlease set these variables in your .env file');
  process.exit(1);
}

// Validate JWT_SECRET is strong enough
if (process.env.JWT_SECRET.length < 32) {
  console.error('ERROR: JWT_SECRET must be at least 32 characters long for security');
  console.error('Current length:', process.env.JWT_SECRET.length);
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// CORS configuration - only allow requests from frontend
const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...(process.env.ADDITIONAL_ORIGINS ? process.env.ADDITIONAL_ORIGINS.split(',').map(o => o.trim()) : []),
  'https://quiz.inspir.uk', // Deployed frontend
  'http://localhost:5173', // Dev frontend
  'http://localhost:3000'  // Dev testing
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/quiz', quizRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/chat', chatRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Quiz app backend is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: err.message
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
