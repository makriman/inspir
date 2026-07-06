CREATE TABLE IF NOT EXISTS `admin_users` (
  `email` text PRIMARY KEY NOT NULL,
  `added_by_user_id` text,
  `added_by_email` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `admin_users_created_idx` ON `admin_users` (`created_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `admin_users` (`email`, `added_by_user_id`, `added_by_email`, `created_at`)
VALUES ('makridroid@gmail.com', NULL, 'system', CAST(strftime('%s','now') AS integer) * 1000);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_events` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `user_id` text,
  `user_email_snapshot` text,
  `route` text,
  `session_id` text,
  `user_agent_hash` text,
  `properties` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `product_events_name_created_idx` ON `product_events` (`name`, `created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `product_events_route_created_idx` ON `product_events` (`route`, `created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `product_events_user_created_idx` ON `product_events` (`user_id`, `created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `product_events_created_idx` ON `product_events` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ops_events` (
  `id` text PRIMARY KEY NOT NULL,
  `event_name` text NOT NULL,
  `severity` text DEFAULT 'info' NOT NULL,
  `surface` text,
  `user_id` text,
  `message` text,
  `metadata` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ops_events_event_created_idx` ON `ops_events` (`event_name`, `created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ops_events_severity_created_idx` ON `ops_events` (`severity`, `created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ops_events_surface_created_idx` ON `ops_events` (`surface`, `created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ops_events_created_idx` ON `ops_events` (`created_at`);
