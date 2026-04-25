ALTER TABLE `music_tracks` ADD COLUMN `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `music_tracks` ADD COLUMN `sync_state` text DEFAULT 'local_only' NOT NULL;
--> statement-breakpoint
ALTER TABLE `music_tracks` ADD COLUMN `dirty` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `music_tracks` ADD COLUMN `last_synced_at` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_tracks_deleted_at_idx` ON `music_tracks` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_tracks_sync_state_idx` ON `music_tracks` (`sync_state`);
--> statement-breakpoint
ALTER TABLE `music_collections` ADD COLUMN `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `music_collections` ADD COLUMN `sync_state` text DEFAULT 'local_only' NOT NULL;
--> statement-breakpoint
ALTER TABLE `music_collections` ADD COLUMN `dirty` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `music_collections` ADD COLUMN `last_synced_at` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_collections_deleted_at_idx` ON `music_collections` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_collections_sync_state_idx` ON `music_collections` (`sync_state`);
--> statement-breakpoint
ALTER TABLE `music_lyric_entries` ADD COLUMN `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `music_lyric_entries` ADD COLUMN `sync_state` text DEFAULT 'local_only' NOT NULL;
--> statement-breakpoint
ALTER TABLE `music_lyric_entries` ADD COLUMN `dirty` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `music_lyric_entries` ADD COLUMN `last_synced_at` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_lyric_entries_deleted_at_idx` ON `music_lyric_entries` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_lyric_entries_sync_state_idx` ON `music_lyric_entries` (`sync_state`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `music_tracks_fts`
USING fts5(
  `track_id` UNINDEXED,
  `title`,
  `artists`,
  `album`,
  `creator`,
  `tags`,
  content=''
);
--> statement-breakpoint
INSERT INTO `music_tracks_fts` (`track_id`, `title`, `artists`, `album`, `creator`, `tags`)
SELECT
  `id`,
  `title`,
  COALESCE(`artists`, ''),
  COALESCE(`album`, ''),
  COALESCE(`creator`, ''),
  COALESCE(`tags`, '')
FROM `music_tracks`
WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `play_source_caches` (
  `cache_key` text PRIMARY KEY NOT NULL,
  `track_id` text NOT NULL,
  `source` text NOT NULL,
  `payload` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `play_source_caches_track_id_idx` ON `play_source_caches` (`track_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `play_source_caches_source_idx` ON `play_source_caches` (`source`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `play_source_cache_statuses` (
  `cache_key` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL,
  `expires_at` integer,
  `error` text,
  `checked_at` integer,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `play_source_cache_statuses_status_idx` ON `play_source_cache_statuses` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `play_source_cache_statuses_expires_at_idx` ON `play_source_cache_statuses` (`expires_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `plugin_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `plugin_id` text NOT NULL,
  `account_id` text NOT NULL,
  `is_default` integer DEFAULT 0 NOT NULL,
  `is_logged_in` integer DEFAULT 0 NOT NULL,
  `profile` text,
  `updated_at` integer NOT NULL,
  `sync_state` text DEFAULT 'local_only' NOT NULL,
  `dirty` integer DEFAULT 0 NOT NULL,
  `last_synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `plugin_accounts_plugin_account_unq` ON `plugin_accounts` (`plugin_id`,`account_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `plugin_accounts_plugin_id_idx` ON `plugin_accounts` (`plugin_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `plugin_accounts_sync_state_idx` ON `plugin_accounts` (`sync_state`);
--> statement-breakpoint
ALTER TABLE `plugin_sessions` ADD COLUMN `active_account_id` text;
--> statement-breakpoint
ALTER TABLE `plugin_sessions` ADD COLUMN `state` text;
--> statement-breakpoint
ALTER TABLE `plugin_sessions` ADD COLUMN `sync_state` text DEFAULT 'local_only' NOT NULL;
--> statement-breakpoint
ALTER TABLE `plugin_sessions` ADD COLUMN `dirty` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `plugin_sessions` ADD COLUMN `last_synced_at` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `plugin_sessions_active_account_id_idx` ON `plugin_sessions` (`active_account_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `plugin_sessions_sync_state_idx` ON `plugin_sessions` (`sync_state`);
--> statement-breakpoint
UPDATE `plugin_sessions`
SET `state` = json_object('user', `user`)
WHERE `state` IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `plugin_credentials` (
  `id` text PRIMARY KEY NOT NULL,
  `plugin_id` text NOT NULL,
  `account_id` text,
  `encrypted_payload` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `plugin_credentials_plugin_account_unq` ON `plugin_credentials` (`plugin_id`,`account_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `plugin_credentials_plugin_id_idx` ON `plugin_credentials` (`plugin_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `plugin_credentials` (`id`, `plugin_id`, `account_id`, `encrypted_payload`, `updated_at`)
SELECT `id`, `plugin_id`, NULL, `encrypted_payload`, `updated_at`
FROM `plugin_session_credentials`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `import_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `source_kind` text NOT NULL,
  `status` text NOT NULL,
  `progress` text,
  `summary` text,
  `started_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `finished_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `import_jobs_status_idx` ON `import_jobs` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `import_jobs_updated_at_idx` ON `import_jobs` (`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `local_files` (
  `id` text PRIMARY KEY NOT NULL,
  `path` text NOT NULL,
  `uri` text,
  `size` integer,
  `hash` text,
  `created_at` integer,
  `modified_at` integer,
  `scanned_at` integer NOT NULL,
  `status` text NOT NULL,
  `metadata` text,
  `import_job_id` text,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `local_files_path_unq` ON `local_files` (`path`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `local_files_status_idx` ON `local_files` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `local_files_hash_idx` ON `local_files` (`hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `local_file_track_links` (
  `local_file_id` text NOT NULL,
  `track_id` text NOT NULL,
  `linked_at` integer NOT NULL,
  PRIMARY KEY(`local_file_id`, `track_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `local_file_track_links_track_id_idx` ON `local_file_track_links` (`track_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `playback_queues` (
  `id` text PRIMARY KEY NOT NULL,
  `state` text,
  `updated_at` integer NOT NULL,
  `sync_state` text DEFAULT 'local_only' NOT NULL,
  `dirty` integer DEFAULT 0 NOT NULL,
  `last_synced_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `playback_queues_sync_state_idx` ON `playback_queues` (`sync_state`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `playback_queue_items` (
  `queue_id` text NOT NULL,
  `position` integer NOT NULL,
  `track_id` text,
  `source` text,
  `payload` text,
  `updated_at` integer NOT NULL,
  `sync_state` text DEFAULT 'local_only' NOT NULL,
  `dirty` integer DEFAULT 0 NOT NULL,
  `last_synced_at` integer,
  PRIMARY KEY(`queue_id`, `position`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `playback_queue_items_track_id_idx` ON `playback_queue_items` (`track_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
  `namespace` text NOT NULL,
  `key` text NOT NULL,
  `value_type` text NOT NULL,
  `value` text,
  `updated_at` integer NOT NULL,
  `sync_state` text DEFAULT 'local_only' NOT NULL,
  `dirty` integer DEFAULT 0 NOT NULL,
  `last_synced_at` integer,
  PRIMARY KEY(`namespace`, `key`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `settings_sync_state_idx` ON `settings` (`sync_state`);
