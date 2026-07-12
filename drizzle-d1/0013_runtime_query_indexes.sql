CREATE INDEX IF NOT EXISTS `rate_limit_windows_reset_at_idx` ON `rate_limit_windows` (`reset_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_runs_created_idx` ON `ai_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ops_events_user_id_idx` ON `ops_events` (`user_id`);
