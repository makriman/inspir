import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import {
  getDailyGoalSettings,
  upsertDailyGoalSettings,
  getTodayProgress,
  incrementTodayProgress,
  listHabits,
  createHabit,
  updateHabit,
  setHabitCheckin,
  getHabitCheckins,
} from '../controllers/goalsController.js';

const router = express.Router();

router.get('/daily/settings', authenticateUser, getDailyGoalSettings);
router.put('/daily/settings', authenticateUser, upsertDailyGoalSettings);
router.get('/daily/today', authenticateUser, getTodayProgress);
router.post('/daily/today/increment', authenticateUser, incrementTodayProgress);

router.get('/habits', authenticateUser, listHabits);
router.post('/habits', authenticateUser, createHabit);
router.patch('/habits/:id', authenticateUser, updateHabit);
router.post('/habits/:id/checkin', authenticateUser, setHabitCheckin);
router.get('/habits/checkins', authenticateUser, getHabitCheckins);

export default router;

