import { supabase } from './supabaseClient.js';

/**
 * Audit Logger
 * Logs security-relevant events to the database for compliance and monitoring
 */

/**
 * Log an audit event
 * @param {Object} params - Audit log parameters
 * @param {string} params.eventType - Type of event (e.g., 'user_login', 'quiz_created')
 * @param {string} params.action - Action performed (e.g., 'create', 'update', 'delete')
 * @param {string} params.status - Status of the action ('success', 'failure', 'blocked')
 * @param {Object} params.req - Express request object
 * @param {string} [params.userId] - User ID (if authenticated)
 * @param {string} [params.username] - Username (if available)
 * @param {string} [params.resourceType] - Type of resource affected
 * @param {string} [params.resourceId] - ID of the resource affected
 * @param {Object} [params.details] - Additional event-specific details
 * @param {string} [params.errorMessage] - Error message if status is 'failure'
 */
export async function logAuditEvent({
  eventType,
  action,
  status,
  req,
  userId = null,
  username = null,
  resourceType = null,
  resourceId = null,
  details = null,
  errorMessage = null
}) {
  try {
    // Extract IP address (handle proxies)
    const ipAddress = req.ip ||
                     req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                     req.connection?.remoteAddress ||
                     req.socket?.remoteAddress ||
                     'unknown';

    // Extract user agent
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Prepare audit log entry
    const auditLog = {
      event_type: eventType,
      user_id: userId,
      username: username,
      ip_address: ipAddress,
      user_agent: userAgent,
      resource_type: resourceType,
      resource_id: resourceId,
      action: action,
      status: status,
      details: details,
      error_message: errorMessage,
      created_at: new Date().toISOString()
    };

    // Insert into database (async, non-blocking)
    const { error } = await supabase
      .from('audit_logs')
      .insert([auditLog]);

    if (error) {
      // Don't throw - we don't want audit logging failures to break the app
      console.error('Failed to write audit log:', error.message);
      console.error('Audit log data:', auditLog);
    }
  } catch (error) {
    // Catch-all to ensure audit logging never crashes the app
    console.error('Audit logging error:', error.message);
  }
}

/**
 * Middleware to automatically log API requests
 * Can be added to specific routes that need audit logging
 */
export function auditMiddleware(eventType, resourceType) {
  return async (req, res, next) => {
    // Store original end function
    const originalEnd = res.end;

    // Override end function to log after response
    res.end = function(...args) {
      // Restore original end
      res.end = originalEnd;

      // Log the event
      logAuditEvent({
        eventType,
        action: req.method.toLowerCase(),
        status: res.statusCode < 400 ? 'success' : 'failure',
        req,
        userId: req.user?.id,
        username: req.user?.username,
        resourceType,
        resourceId: req.params?.id || req.params?.quizId || req.params?.shareToken,
        details: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode
        }
      });

      // Call original end
      return originalEnd.apply(this, args);
    };

    next();
  };
}

// Predefined event types for consistency
export const AuditEventTypes = {
  // Authentication events
  USER_SIGNUP: 'user_signup',
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  AUTH_FAILURE: 'auth_failure',

  // Quiz events
  QUIZ_CREATED: 'quiz_created',
  QUIZ_ACCESSED: 'quiz_accessed',
  QUIZ_SHARED: 'quiz_shared',
  QUIZ_SUBMITTED: 'quiz_submitted',
  QUIZ_DELETED: 'quiz_deleted',

  // Security events
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  INVALID_TOKEN: 'invalid_token',
  CORS_VIOLATION: 'cors_violation'
};

// Predefined actions
export const AuditActions = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  SHARE: 'share',
  ACCESS: 'access',
  SUBMIT: 'submit',
  LOGIN: 'login',
  LOGOUT: 'logout',
  SIGNUP: 'signup'
};

// Predefined statuses
export const AuditStatus = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  BLOCKED: 'blocked'
};
