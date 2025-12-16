import express from 'express';
import multer from 'multer';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';
import {
  generateFlashcards,
  getUserDecks,
  getDeckById,
  getStudySession,
  recordStudyProgress,
  shareDeck,
  deleteDeck,
  getSharedDeck
} from '../controllers/flashcardController.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, and TXT files are allowed.'));
    }
  }
});

// Generate flashcards (with optional authentication for saving)
router.post('/generate', optionalAuth, upload.single('file'), generateFlashcards);

// Get all decks for user (requires authentication)
router.get('/decks', authenticateUser, getUserDecks);

// Get specific deck by ID
router.get('/deck/:id', optionalAuth, getDeckById);

// Get study session (cards to study now)
router.get('/deck/:id/study', authenticateUser, getStudySession);

// Record study progress (requires authentication)
router.post('/deck/:id/progress', authenticateUser, recordStudyProgress);

// Share deck (requires authentication)
router.post('/deck/:id/share', authenticateUser, shareDeck);

// Delete deck (requires authentication)
router.delete('/deck/:id', authenticateUser, deleteDeck);

// Get shared deck by token (public)
router.get('/shared/:token', getSharedDeck);

export default router;
