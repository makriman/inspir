-- Audit Logging System
-- This table tracks security-relevant events for compliance and security monitoring

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  username VARCHAR(255),
  ip_address VARCHAR(45), -- IPv6 compatible
  user_agent TEXT,
  resource_type VARCHAR(50), -- 'quiz', 'auth', 'user', etc.
  resource_id VARCHAR(255), -- ID of the affected resource
  action VARCHAR(50) NOT NULL, -- 'create', 'update', 'delete', 'access', 'share', etc.
  status VARCHAR(20) NOT NULL, -- 'success', 'failure', 'blocked'
  details JSONB, -- Additional context-specific information
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Add comments for documentation
COMMENT ON TABLE audit_logs IS 'Security audit log for tracking critical system events';
COMMENT ON COLUMN audit_logs.event_type IS 'Type of event: user_login, user_signup, quiz_created, quiz_shared, etc.';
COMMENT ON COLUMN audit_logs.status IS 'Outcome of the action: success, failure, or blocked';
COMMENT ON COLUMN audit_logs.details IS 'Additional JSON metadata specific to the event type';

-- Row Level Security (RLS) - Only admins should read audit logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users cannot access audit logs (admin-only in future)
-- For now, disable all access via RLS
CREATE POLICY "Audit logs are admin-only" ON audit_logs
  FOR SELECT
  USING (false);

-- Grant necessary permissions
-- Note: The service role key bypasses RLS, so backend can write logs
