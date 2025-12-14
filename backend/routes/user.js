import express from 'express';
import { getHomepageStats } from '../controllers/userStatsController.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.get('/homepage-stats', authenticateUser, getHomepageStats);

export default router;
