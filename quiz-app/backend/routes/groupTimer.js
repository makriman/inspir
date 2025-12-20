import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import {
  createRoom,
  joinRoom,
  getRoomState,
  startRoom,
  heartbeat,
} from '../controllers/groupTimerController.js';

const router = express.Router();

router.post('/rooms', authenticateUser, createRoom);
router.post('/rooms/:roomCode/join', authenticateUser, joinRoom);
router.get('/rooms/:roomCode', authenticateUser, getRoomState);
router.post('/rooms/:roomCode/start', authenticateUser, startRoom);
router.post('/rooms/:roomCode/heartbeat', authenticateUser, heartbeat);

export default router;

