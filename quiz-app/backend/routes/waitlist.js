import express from 'express';
import { addToWaitlist, getWaitlistCount } from '../controllers/waitlistController.js';

const router = express.Router();

// Public route - no authentication required
router.post('/', addToWaitlist);

// Optional admin route
router.get('/:tool_id/count', getWaitlistCount);

export default router;
