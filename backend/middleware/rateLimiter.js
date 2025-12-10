import rateLimit from 'express-rate-limit';

// Strict rate limiter for authentication endpoints
// Prevents brute force attacks
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'Too many authentication attempts',
    message: 'Please try again in 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});

// Rate limiter for quiz generation
// Prevents AI API abuse (Claude API calls are expensive)
export const quizGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 quiz generations per hour
  message: {
    error: 'Quiz generation limit exceeded',
    message: 'You can generate up to 20 quizzes per hour. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// General API rate limiter
// Prevents general abuse and DoS
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    error: 'Too many requests',
    message: 'Please slow down and try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for quiz submission
// Prevents spam submissions
export const quizSubmissionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 submissions per 5 minutes
  message: {
    error: 'Too many quiz submissions',
    message: 'Please wait a few minutes before submitting again'
  },
  standardHeaders: true,
  legacyHeaders: false
});
