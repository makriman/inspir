import express from 'express';
import multer from 'multer';
import { authenticateUser, optionalAuth } from '../middleware/auth.js';
import {
  generateSummary,
  getSummaryHistory,
  getSummaryById,
  deleteSummary
} from '../controllers/summarizerController.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
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

// Generate summary (with optional authentication for saving)
router.post('/generate', optionalAuth, upload.single('file'), generateSummary);

// Get summary history (requires authentication)
router.get('/history', authenticateUser, getSummaryHistory);

// Get specific summary by ID
router.get('/:id', optionalAuth, getSummaryById);

// Delete summary (requires authentication)
router.delete('/:id', authenticateUser, deleteSummary);

export default router;
