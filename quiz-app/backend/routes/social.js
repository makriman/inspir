import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import {
  createStudyGroup,
  joinStudyGroup,
  listMyStudyGroups,
  getStudyGroup,
  listResources,
  createResource,
} from '../controllers/socialController.js';

const router = express.Router();

// Study groups
router.get('/groups', authenticateUser, listMyStudyGroups);
router.post('/groups', authenticateUser, createStudyGroup);
router.post('/groups/join/:joinCode', authenticateUser, joinStudyGroup);
router.get('/groups/:id', authenticateUser, getStudyGroup);

// Resource sharing
router.get('/resources', authenticateUser, listResources);
router.post('/resources', authenticateUser, createResource);

export default router;

