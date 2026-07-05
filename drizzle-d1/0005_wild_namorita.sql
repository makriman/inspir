DROP TABLE IF EXISTS `legacy_chat_snapshots`;--> statement-breakpoint
DROP TABLE IF EXISTS `legacy_dummy_data`;--> statement-breakpoint
DROP TABLE IF EXISTS `source_timestamp_precision`;--> statement-breakpoint
DROP TABLE IF EXISTS `topic_legacy_ids`;--> statement-breakpoint
ALTER TABLE `chats` DROP COLUMN `legacy_topic_id`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `legacy_sender_id`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `legacy_user_id`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `legacy_topic_id`;
