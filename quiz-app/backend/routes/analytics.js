import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import {
  getProgressOverview,
  getReportPreferences,
  upsertReportPreferences,
  generateWeeklyReport,
  listWeeklyReports,
} from '../controllers/analyticsController.js';

const router = express.Router();

router.get('/progress/overview', authenticateUser, getProgressOverview);
router.get('/reports/preferences', authenticateUser, getReportPreferences);
router.put('/reports/preferences', authenticateUser, upsertReportPreferences);
router.post('/reports/weekly/generate', authenticateUser, generateWeeklyReport);
router.get('/reports/weekly', authenticateUser, listWeeklyReports);

export default router;

