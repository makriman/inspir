/**
 * Content Moderation System for Kid-Safe Chat
 * Filters inappropriate content to keep the chat safe for students
 */

// Inappropriate content patterns (kid-safety focused)
const BLOCKED_PATTERNS = [
  // Violence & harm
  /\b(kill|murder|suicide|self-harm|hurt yourself)\b/gi,
  // Explicit content
  /\b(porn|sex|xxx|nude)\b/gi,
  // Drugs & alcohol (educational exceptions allowed)
  /\b(get high|smoke weed|buy drugs)\b/gi,
  // Personal info requests
  /\b(home address|phone number|social security|credit card)\b/gi,
  // Bullying language
  /\b(kill yourself|you're stupid|loser|idiot kid)\b/gi,
];

// Topics to flag for review (not blocked, but logged)
const FLAGGED_TOPICS = [
  /\b(depression|anxiety|scared|bullied|afraid)\b/gi,
  /\b(homework answer|test answer|cheat)\b/gi,
];

// Age-appropriate system prompt for Claude
export const STUDENT_SYSTEM_PROMPT = `You are a friendly, helpful AI tutor designed for students aged 8-18. Your role is to:

1. Help students learn and understand concepts, not just give answers
2. Encourage critical thinking by asking guiding questions
3. Be patient, kind, and encouraging
4. Use age-appropriate language and examples
5. Never provide harmful, inappropriate, or explicit content
6. Refuse to help with cheating (e.g., doing homework for them)
7. If a student seems distressed, encourage them to talk to a trusted adult

Safety Guidelines:
- Never share personal information
- Don't engage with inappropriate topics
- Redirect concerning conversations to trusted adults
- Focus on education and positive support

Remember: You're here to help students learn and grow in a safe environment!`;

/**
 * Check if content is appropriate for students
 * @param {string} content - The text to check
 * @returns {Object} - { allowed: boolean, reason: string, flagged: boolean }
 */
export function moderateContent(content) {
  if (!content || typeof content !== 'string') {
    return { allowed: true, reason: null, flagged: false };
  }

  const lowerContent = content.toLowerCase();

  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(content)) {
      return {
        allowed: false,
        reason: 'Content contains inappropriate language or topics',
        flagged: true,
        severity: 'high'
      };
    }
  }

  // Check for flagged topics (allowed but logged)
  let flagged = false;
  let flagReason = null;

  for (const pattern of FLAGGED_TOPICS) {
    if (pattern.test(content)) {
      flagged = true;
      flagReason = 'Content contains sensitive topics';
      break;
    }
  }

  // Check for excessive caps (shouting/aggression)
  const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
  if (capsRatio > 0.5 && content.length > 20) {
    flagged = true;
    flagReason = 'Excessive capitalization detected';
  }

  // Check for excessive repeated characters (spam)
  if (/(.)\1{10,}/.test(content)) {
    return {
      allowed: false,
      reason: 'Spam or excessive repeated characters',
      flagged: true,
      severity: 'low'
    };
  }

  // Check for attempts to jailbreak or manipulate
  const jailbreakPatterns = [
    /ignore (previous|above|all) instructions/gi,
    /you are now|act as|pretend (to be|you are)/gi,
    /forget your (rules|guidelines|instructions)/gi,
    /developer mode|jailbreak|DAN mode/gi,
  ];

  for (const pattern of jailbreakPatterns) {
    if (pattern.test(content)) {
      return {
        allowed: false,
        reason: 'Attempt to bypass safety guidelines detected',
        flagged: true,
        severity: 'high'
      };
    }
  }

  return {
    allowed: true,
    reason: flagReason,
    flagged,
    severity: flagged ? 'medium' : null
  };
}

/**
 * Generate a safe, educational response when content is blocked
 * @param {string} reason - Why the content was blocked
 * @returns {string} - Friendly rejection message
 */
export function generateBlockedMessage(reason) {
  const messages = [
    "I'm here to help you learn in a safe and positive way! Let's talk about something educational instead. What subject are you studying?",
    "That topic isn't something I can help with. But I'd love to help you with homework, explain concepts, or answer questions about your studies!",
    "Let's keep our conversation educational and fun! Is there a school subject or topic you'd like to explore?",
    "I'm designed to be a helpful study buddy! How about we focus on learning something new? What are you curious about?"
  ];

  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Auto-generate a title for a conversation based on first message
 * @param {string} content - First user message
 * @returns {string} - Generated title
 */
export function generateConversationTitle(content) {
  if (!content || typeof content !== 'string') {
    return 'New Chat';
  }

  // Truncate and clean
  let title = content.trim().substring(0, 60);

  // Remove newlines
  title = title.replace(/\n/g, ' ');

  // Add ellipsis if truncated
  if (content.length > 60) {
    title += '...';
  }

  // Detect topic keywords for better titles
  const topicMap = {
    math: ['math', 'algebra', 'geometry', 'calculus', 'equation', 'solve'],
    science: ['science', 'biology', 'chemistry', 'physics', 'atom', 'cell'],
    history: ['history', 'war', 'ancient', 'revolution', 'president'],
    english: ['essay', 'write', 'grammar', 'literature', 'book', 'reading'],
    coding: ['code', 'program', 'python', 'javascript', 'html', 'function'],
  };

  const lowerContent = content.toLowerCase();
  for (const [topic, keywords] of Object.entries(topicMap)) {
    if (keywords.some(keyword => lowerContent.includes(keyword))) {
      return `${topic.charAt(0).toUpperCase() + topic.slice(1)}: ${title}`;
    }
  }

  return title;
}

/**
 * Rate limit check for chat messages (prevent spam)
 * @param {number} messageCount - Messages sent in time window
 * @param {number} timeWindowMs - Time window in milliseconds
 * @returns {Object} - { allowed: boolean, reason: string }
 */
export function checkChatRateLimit(messageCount, timeWindowMs = 60000) {
  const maxMessagesPerMinute = 20; // 20 messages per minute max

  if (messageCount > maxMessagesPerMinute) {
    return {
      allowed: false,
      reason: 'Please slow down! You can send up to 20 messages per minute.'
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Estimate tokens for billing/usage tracking
 * Rough approximation: 1 token ≈ 4 characters
 * @param {string} text - Text to estimate
 * @returns {number} - Estimated tokens
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
