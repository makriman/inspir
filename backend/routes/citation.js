import express from 'express';
import {
  generateCitationHandler,
  getCitationHistory,
  getCitation,
  updateCitation,
  deleteCitation,
  createProject,
  getProjects,
  exportBibliography
} from '../controllers/citationController.js';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Public route - generate citation (works for guests and authenticated users)
router.post('/generate', optionalAuth, generateCitationHandler);

// Authenticated routes - citation management
router.get('/history', authenticateUser, getCitationHistory);
router.get('/:id', authenticateUser, getCitation);
router.put('/:id', authenticateUser, updateCitation);
router.delete('/:id', authenticateUser, deleteCitation);

// Project management routes
router.post('/projects', authenticateUser, createProject);
router.get('/projects/list', authenticateUser, getProjects);
router.get('/projects/:projectId/export', authenticateUser, exportBibliography);

export default router;
