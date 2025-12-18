import express from 'express';
import {
  logActivity,
  getStreak,
  getActivityHistory,
  getActivityStats
} from '../controllers/streaksController.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.post('/activity', authenticateUser, logActivity);
router.get('/current', authenticateUser, getStreak);
router.get('/history', authenticateUser, getActivityHistory);
router.get('/stats', authenticateUser, getActivityStats);

export default router;
