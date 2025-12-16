import express from 'express';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';
import { solveMathProblem, getSolutionHistory, generatePracticeProblems } from '../controllers/mathSolverController.js';

const router = express.Router();

router.post('/solve', optionalAuth, solveMathProblem);
router.get('/history', authenticateUser, getSolutionHistory);
router.post('/solution/:id/practice', authenticateUser, generatePracticeProblems);

export default router;
