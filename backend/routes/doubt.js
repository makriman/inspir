import express from 'express';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';
import {
  uploadAndExtractImage,
  solveDoubt,
  getDoubtHistory,
  getDoubt,
  updateDoubt,
  deleteDoubt,
  getRecentSolutions,
  createShare,
  getSharedDoubt
} from '../controllers/doubtController.js';

const router = express.Router();

// Public routes (no auth required)
router.post('/upload-image', uploadAndExtractImage);
router.post('/solve', optionalAuth, solveDoubt);
router.get('/recent', getRecentSolutions);
router.get('/shared/:shareToken', getSharedDoubt);

// Protected routes (auth required)
router.get('/history', authenticateUser, getDoubtHistory);
router.get('/:id', optionalAuth, getDoubt);
router.put('/:id', authenticateUser, updateDoubt);
router.delete('/:id', authenticateUser, deleteDoubt);
router.post('/:doubtId/share', authenticateUser, createShare);

export default router;
