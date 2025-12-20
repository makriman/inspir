import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import {
  listTaskTimerTasks,
  createTaskTimerTask,
  updateTaskTimerTask,
  deleteTaskTimerTask,
  logTaskTimerSession,
  listTaskTimerSessions,
  getBreakReminderSettings,
  upsertBreakReminderSettings,
  createDeepWorkSession,
  updateDeepWorkSession,
  listDeepWorkSessions,
} from '../controllers/productivityController.js';

const router = express.Router();

router.get('/task-timer/tasks', authenticateUser, listTaskTimerTasks);
router.post('/task-timer/tasks', authenticateUser, createTaskTimerTask);
router.patch('/task-timer/tasks/:id', authenticateUser, updateTaskTimerTask);
router.delete('/task-timer/tasks/:id', authenticateUser, deleteTaskTimerTask);
router.get('/task-timer/sessions', authenticateUser, listTaskTimerSessions);
router.post('/task-timer/sessions', authenticateUser, logTaskTimerSession);

router.get('/break-reminder/settings', authenticateUser, getBreakReminderSettings);
router.put('/break-reminder/settings', authenticateUser, upsertBreakReminderSettings);

router.get('/deep-work/sessions', authenticateUser, listDeepWorkSessions);
router.post('/deep-work/sessions', authenticateUser, createDeepWorkSession);
router.patch('/deep-work/sessions/:id', authenticateUser, updateDeepWorkSession);

export default router;

