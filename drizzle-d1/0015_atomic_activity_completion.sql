-- Existing completed activities intentionally retain NULL receipts. They have
-- already had their historical side effects (if any), so they must never be
-- replayed or backfilled into the exactly-once path.
ALTER TABLE `activity_runs` ADD `completion_token` text;--> statement-breakpoint
ALTER TABLE `activity_runs` ADD `completion_message_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `activity_runs_completion_token_uidx`
  ON `activity_runs` (`completion_token`)
  WHERE `completion_token` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `activity_runs_completion_message_id_uidx`
  ON `activity_runs` (`completion_message_id`)
  WHERE `completion_message_id` IS NOT NULL;
