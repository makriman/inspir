CREATE INDEX IF NOT EXISTS `users_normalized_email_lookup_idx`
ON `users` (lower(`email`), `id`, `email`);
