import express from 'express';
import multer from 'multer';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';
import {
  generateStudyGuide,
  getStudyGuides,
  getStudyGuideById,
  updateStudyGuide,
  shareStudyGuide,
  deleteStudyGuide,
  getSharedStudyGuide
} from '../controllers/studyGuideController.js';

const router = express.Router();

// Configure multer for multiple file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 5 // Max 5 files
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, and TXT files are allowed.'));
    }
  }
});

// Generate study guide (with optional authentication for saving)
router.post('/generate', optionalAuth, upload.array('files', 5), generateStudyGuide);

// Get all study guides for user (requires authentication)
router.get('/', authenticateUser, getStudyGuides);

// Get specific study guide by ID
router.get('/:id', optionalAuth, getStudyGuideById);

// Update study guide (requires authentication)
router.put('/:id', authenticateUser, updateStudyGuide);

// Share study guide (requires authentication)
router.post('/:id/share', authenticateUser, shareStudyGuide);

// Delete study guide (requires authentication)
router.delete('/:id', authenticateUser, deleteStudyGuide);

// Get shared study guide by token (public)
router.get('/shared/:token', getSharedStudyGuide);

export default router;
