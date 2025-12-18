import express from 'express';
import {
  signup,
  login,
  logout,
  getCurrentUser
} from '../controllers/authController.js';
import { authenticateUser } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Apply rate limiting to authentication endpoints
router.post('/signup', authLimiter, signup);
router.post('/login', authLimiter, login);
router.post('/logout', logout);
router.get('/me', authenticateUser, getCurrentUser);

export default router;
