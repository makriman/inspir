import express from 'express';
import {
  getQuestions,
  getQuestion,
  createQuestion,
  createAnswer,
  upvoteAnswer,
  removeUpvote,
  getLeaderboard,
  getUserReputation,
  getStats
} from '../controllers/forumController.js';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Public routes (anyone can view)
router.get('/questions', getQuestions);
router.get('/questions/:id', getQuestion);
router.get('/leaderboard', getLeaderboard);
router.get('/stats', getStats);

// Protected routes (require authentication)
router.post('/questions', authenticateUser, createQuestion);
router.post('/questions/:questionId/answers', authenticateUser, createAnswer);
router.post('/answers/:answerId/upvote', authenticateUser, upvoteAnswer);
router.delete('/answers/:answerId/upvote', authenticateUser, removeUpvote);
router.get('/reputation', authenticateUser, getUserReputation);

export default router;
