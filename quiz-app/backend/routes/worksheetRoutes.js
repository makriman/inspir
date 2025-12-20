import express from 'express';
import multer from 'multer';
import { optionalAuth } from '../middleware/auth.js';
import { generateWorksheet } from '../controllers/worksheetController.js';

const router = express.Router();

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, and TXT files are allowed.'));
    }
  },
});

router.post('/generate', optionalAuth, upload.single('file'), generateWorksheet);

export default router;

