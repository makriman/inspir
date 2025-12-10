import express from 'express';
import {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  deleteConversation,
  updateConversation,
  searchMessages
} from '../controllers/chatController.js';
import { authenticateUser } from '../middleware/auth.js';
import { quizGenerationLimiter } from '../middleware/rateLimiter.js'; // Reuse for chat too

const router = express.Router();

// All chat routes require authentication
router.use(authenticateUser);

// Conversations
router.post('/conversations', createConversation);
router.get('/conversations', getConversations);
router.get('/conversations/:conversationId', getMessages);
router.patch('/conversations/:conversationId', updateConversation);
router.delete('/conversations/:conversationId', deleteConversation);

// Messages
router.post('/conversations/:conversationId/messages', quizGenerationLimiter, sendMessage);

// Search
router.get('/search', searchMessages);

export default router;
