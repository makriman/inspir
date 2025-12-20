import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import {
  getXp,
  listXpEvents,
  awardXp,
  listBadges,
  awardBadge,
  getLeaderboards,
  listChallenges,
  createChallenge,
  updateChallengeProgress,
  listMilestones,
  createMilestone,
  getAccountabilityPartner,
  setAccountabilityPartner,
  listAccountabilityCheckins,
  sendAccountabilityCheckin,
} from '../controllers/gamificationController.js';

const router = express.Router();

// Public leaderboard
router.get('/leaderboards', getLeaderboards);

// XP
router.get('/xp', authenticateUser, getXp);
router.get('/xp/events', authenticateUser, listXpEvents);
router.post('/xp/award', authenticateUser, awardXp);

// Badges
router.get('/badges', authenticateUser, listBadges);
router.post('/badges/award', authenticateUser, awardBadge);

// Challenges
router.get('/challenges', authenticateUser, listChallenges);
router.post('/challenges', authenticateUser, createChallenge);
router.post('/challenges/:id/progress', authenticateUser, updateChallengeProgress);

// Milestones
router.get('/milestones', authenticateUser, listMilestones);
router.post('/milestones', authenticateUser, createMilestone);

// Accountability
router.get('/accountability/partner', authenticateUser, getAccountabilityPartner);
router.post('/accountability/partner', authenticateUser, setAccountabilityPartner);
router.get('/accountability/checkins', authenticateUser, listAccountabilityCheckins);
router.post('/accountability/checkins', authenticateUser, sendAccountabilityCheckin);

export default router;

