CREATE TABLE IF NOT EXISTS `game_results` (
  `id` text PRIMARY KEY NOT NULL,
  `schema_version` integer NOT NULL CHECK (`schema_version` = 1),
  `game_slug` text NOT NULL CHECK (`game_slug` IN ('tic-tac-toe', 'connect-four', 'chess')),
  `engine_id` text NOT NULL,
  `engine_version` text NOT NULL,
  `terminal_code` text NOT NULL,
  `winner` text NOT NULL CHECK (`winner` IN ('human', 'opponent', 'draw')),
  `outcome` text NOT NULL CHECK (`outcome` IN ('win', 'loss', 'draw')),
  `ply_count` integer NOT NULL CHECK (`ply_count` >= 0 AND `ply_count` <= 128),
  `payload` text NOT NULL CHECK (json_valid(`payload`)),
  `started_at` integer,
  `completed_at` integer NOT NULL,
  `duration_ms` integer CHECK (`duration_ms` IS NULL OR (`duration_ms` >= 0 AND `duration_ms` <= 86400000)),
  `created_at` integer NOT NULL,
  CHECK ((`started_at` IS NULL AND `duration_ms` IS NULL) OR (`started_at` IS NOT NULL AND `duration_ms` IS NOT NULL)),
  CHECK (`started_at` IS NULL OR `started_at` <= `completed_at`),
  CHECK (`completed_at` = `created_at`)
);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `game_results_reject_update`
BEFORE UPDATE ON `game_results`
BEGIN
  SELECT RAISE(ABORT, 'game_results rows are immutable');
END;
