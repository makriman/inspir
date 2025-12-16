import express from 'express';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';
import { generateConceptMap, getConceptMaps, getConceptMapById, updateConceptMap, deleteConceptMap } from '../controllers/conceptMapController.js';

const router = express.Router();

router.post('/generate', optionalAuth, generateConceptMap);
router.get('/', authenticateUser, getConceptMaps);
router.get('/:id', optionalAuth, getConceptMapById);
router.put('/:id', authenticateUser, updateConceptMap);
router.delete('/:id', authenticateUser, deleteConceptMap);

export default router;
