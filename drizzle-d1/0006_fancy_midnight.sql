CREATE INDEX `chat_memory_turns_user_updated_idx` ON `chat_memory_turns` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `chats_user_archive_updated_idx` ON `chats` (`user_id`,`is_archived`,`updated_at`);--> statement-breakpoint
CREATE INDEX `messages_chat_role_created_idx` ON `messages` (`chat_id`,`role`,`created_at`);--> statement-breakpoint
CREATE INDEX `user_memories_user_status_salience_updated_idx` ON `user_memories` (`user_id`,`status`,`salience`,`updated_at`);--> statement-breakpoint
CREATE INDEX `user_memories_user_source_message_idx` ON `user_memories` (`user_id`,`source_message_id`);