import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { getAudioPreferences, upsertAudioPreferences } from '../controllers/audioController.js';

const router = express.Router();

router.get('/preferences', authenticateUser, getAudioPreferences);
router.put('/preferences', authenticateUser, upsertAudioPreferences);

export default router;

