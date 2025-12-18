import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  createQuiz,
  submitQuiz,
  getQuizHistory,
  getQuizById,
  shareQuiz,
  getSharedQuiz,
  submitSharedQuiz,
  getQuizAttempts
} from '../controllers/quizController.js';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';
import { quizGenerationLimiter, quizSubmissionLimiter } from '../middleware/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow TXT and DOCX files (PDF processing not yet implemented)
    const allowedTypes = /txt|docx?$/i;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    // Allowed MIME types
    const allowedMimes = [
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    const mimetype = allowedMimes.includes(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only TXT, DOC, and DOCX files are allowed'));
    }
  }
});

// Create quiz (with optional authentication and rate limiting)
router.post('/generate', quizGenerationLimiter, optionalAuth, upload.single('file'), createQuiz);

// Submit quiz answers (with rate limiting)
router.post('/submit', quizSubmissionLimiter, optionalAuth, submitQuiz);

// Get quiz history (requires authentication)
router.get('/history', authenticateUser, getQuizHistory);

// Share a quiz (requires authentication)
router.post('/:quizId/share', authenticateUser, shareQuiz);

// Get quiz attempts/statistics (requires authentication, only for quiz creator)
router.get('/:quizId/attempts', authenticateUser, getQuizAttempts);

// Get shared quiz by token (public)
router.get('/shared/:shareToken', getSharedQuiz);

// Submit shared quiz attempt (public with optional authentication and rate limiting)
router.post('/shared/:shareToken/submit', quizSubmissionLimiter, optionalAuth, submitSharedQuiz);

// Get specific quiz by ID
router.get('/:id', optionalAuth, getQuizById);

export default router;
