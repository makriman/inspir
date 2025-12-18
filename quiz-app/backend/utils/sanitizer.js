import validator from 'validator';

/**
 * Input Sanitization Utilities
 * Protects against XSS, SQL injection, and other input-based attacks
 */

/**
 * Sanitize a string for safe storage and display
 * Escapes HTML entities to prevent XSS
 */
export function sanitizeString(input) {
  if (!input || typeof input !== 'string') {
    return input;
  }

  // Escape HTML entities
  return validator.escape(input.trim());
}

/**
 * Sanitize username - alphanumeric, underscores, hyphens only
 */
export function sanitizeUsername(username) {
  if (!username || typeof username !== 'string') {
    throw new Error('Invalid username');
  }

  const trimmed = username.trim();

  // Check length
  if (trimmed.length < 3 || trimmed.length > 50) {
    throw new Error('Username must be between 3 and 50 characters');
  }

  // Only allow alphanumeric, underscores, hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
  }

  return trimmed;
}

/**
 * Sanitize quiz source name
 */
export function sanitizeSourceName(sourceName) {
  if (!sourceName || typeof sourceName !== 'string') {
    return 'Untitled Quiz';
  }

  const trimmed = sourceName.trim();

  // Limit length
  if (trimmed.length > 200) {
    return sanitizeString(trimmed.substring(0, 200));
  }

  return sanitizeString(trimmed);
}

/**
 * Sanitize attempt name for shared quizzes
 */
export function sanitizeAttemptName(attemptName) {
  if (!attemptName || typeof attemptName !== 'string') {
    throw new Error('Attempt name is required');
  }

  const trimmed = attemptName.trim();

  if (trimmed.length === 0) {
    throw new Error('Attempt name cannot be empty');
  }

  if (trimmed.length > 50) {
    throw new Error('Attempt name must be 50 characters or less');
  }

  return sanitizeString(trimmed);
}

/**
 * Sanitize text content for quiz generation
 */
export function sanitizeContent(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const trimmed = content.trim();

  // Limit content size to prevent abuse (100KB max)
  if (trimmed.length > 100000) {
    throw new Error('Content is too large. Maximum 100,000 characters allowed.');
  }

  return trimmed;
}

/**
 * Sanitize an array of user answers
 */
export function sanitizeAnswers(answers) {
  if (!Array.isArray(answers)) {
    throw new Error('Answers must be an array');
  }

  return answers.map(answer => {
    if (typeof answer !== 'string') {
      return String(answer);
    }

    // Limit answer length
    if (answer.length > 5000) {
      return sanitizeString(answer.substring(0, 5000));
    }

    return sanitizeString(answer);
  });
}

/**
 * Validate and sanitize email (if/when email feature is added)
 */
export function sanitizeEmail(email) {
  if (!email || typeof email !== 'string') {
    throw new Error('Invalid email');
  }

  const trimmed = email.trim().toLowerCase();

  if (!validator.isEmail(trimmed)) {
    throw new Error('Invalid email format');
  }

  return trimmed;
}

/**
 * Sanitize URL for share links
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const trimmed = url.trim();

  if (!validator.isURL(trimmed, {
    protocols: ['http', 'https'],
    require_protocol: true
  })) {
    throw new Error('Invalid URL format');
  }

  return trimmed;
}

/**
 * Remove potentially dangerous characters from file names
 */
export function sanitizeFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return 'file';
  }

  // Remove path traversal attempts
  let sanitized = fileName.replace(/\.\./g, '');

  // Remove special characters except dots, hyphens, underscores
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Limit length
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }

  return sanitized;
}
