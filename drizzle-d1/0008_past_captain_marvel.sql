ALTER TABLE `users` ADD `email_verified_at` integer;--> statement-breakpoint
UPDATE `users` SET `email_verified_at` = `email_verified` WHERE `email_verified` IS NOT NULL AND `email_verified` != 0;--> statement-breakpoint
UPDATE `users` SET `email_verified` = CASE WHEN `email_verified` IS NULL OR `email_verified` = 0 THEN 0 ELSE 1 END;--> statement-breakpoint
ALTER TABLE `accounts` ADD `id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `access_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `refresh_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `password` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `updated_at` integer;--> statement-breakpoint
UPDATE `accounts` SET `id` = `provider` || ':' || `provider_account_id` WHERE `id` IS NULL;--> statement-breakpoint
UPDATE `accounts` SET `access_token_expires_at` = `expires_at` * 1000 WHERE `access_token_expires_at` IS NULL AND `expires_at` IS NOT NULL;--> statement-breakpoint
UPDATE `accounts` SET `created_at` = COALESCE((SELECT `created_at` FROM `users` WHERE `users`.`id` = `accounts`.`user_id`), CAST(strftime('%s','now') AS integer) * 1000) WHERE `created_at` IS NULL;--> statement-breakpoint
UPDATE `accounts` SET `updated_at` = COALESCE((SELECT `updated_at` FROM `users` WHERE `users`.`id` = `accounts`.`user_id`), `created_at`, CAST(strftime('%s','now') AS integer) * 1000) WHERE `updated_at` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_id_uidx` ON `accounts` (`id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `ip_address` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `user_agent` text;--> statement-breakpoint
UPDATE `sessions` SET `id` = `session_token` WHERE `id` IS NULL;--> statement-breakpoint
UPDATE `sessions` SET `created_at` = CAST(strftime('%s','now') AS integer) * 1000 WHERE `created_at` IS NULL;--> statement-breakpoint
UPDATE `sessions` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_id_uidx` ON `sessions` (`id`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
ALTER TABLE `verification_tokens` ADD `id` text;--> statement-breakpoint
ALTER TABLE `verification_tokens` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `verification_tokens` ADD `updated_at` integer;--> statement-breakpoint
UPDATE `verification_tokens` SET `id` = `identifier` || ':' || `token` WHERE `id` IS NULL;--> statement-breakpoint
UPDATE `verification_tokens` SET `created_at` = CAST(strftime('%s','now') AS integer) * 1000 WHERE `created_at` IS NULL;--> statement-breakpoint
UPDATE `verification_tokens` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `verification_tokens_id_uidx` ON `verification_tokens` (`id`);
