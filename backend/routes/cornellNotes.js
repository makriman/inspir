import express from 'express';
import {
  generateNotes,
  getNotesHistory,
  getNote,
  updateNote,
  deleteNote
} from '../controllers/cornellNotesController.js';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Public route - generate Cornell notes (works for guests and authenticated users)
router.post('/generate', optionalAuth, generateNotes);

// Authenticated routes - notes management
router.get('/history', authenticateUser, getNotesHistory);
router.get('/:id', authenticateUser, getNote);
router.put('/:id', authenticateUser, updateNote);
router.delete('/:id', authenticateUser, deleteNote);

export default router;
