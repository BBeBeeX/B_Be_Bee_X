CREATE TABLE IF NOT EXISTS `music_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`cover` text,
	`creator` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`artists` text,
	`album` text,
	`source` text NOT NULL,
	`active_source` text,
	`source_id` text NOT NULL,
	`source_sub_id` text,
	`raw` text,
	`available` integer,
	`availability_reason` text,
	`description` text,
	`tags` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `music_tracks_source_identity_unq` ON `music_tracks` (`source`,`source_id`,`source_sub_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_tracks_source_idx` ON `music_tracks` (`source`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_tracks_updated_at_idx` ON `music_tracks` (`updated_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `music_tracks` (
	`id`,
	`title`,
	`cover`,
	`creator`,
	`created_at`,
	`updated_at`,
	`duration_ms`,
	`artists`,
	`album`,
	`source`,
	`active_source`,
	`source_id`,
	`source_sub_id`
)
SELECT
	`id`,
	`title`,
	`cover`,
	`upper`,
	`created_at`,
	`updated_at`,
	`duration`,
	CASE
		WHEN `music_artist` IS NOT NULL AND TRIM(`music_artist`) <> '' THEN json_array(json_object('name', `music_artist`))
		ELSE NULL
	END,
	CASE
		WHEN `music_album` IS NOT NULL AND TRIM(`music_album`) <> '' THEN json_object('title', `music_album`)
		ELSE NULL
	END,
	`source`,
	`active_source`,
	`online_id`,
	NULLIF(`online_sub_id`, '')
FROM `music_songs`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `music_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`cover` text,
	`creator` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_top` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`item_count` integer,
	`source` text NOT NULL,
	`active_source` text,
	`source_id` text NOT NULL,
	`source_sub_id` text,
	`raw` text,
	`available` integer,
	`availability_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `music_collections_source_identity_unq` ON `music_collections` (`source`,`source_id`,`source_sub_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_collections_source_idx` ON `music_collections` (`source`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_collections_updated_at_idx` ON `music_collections` (`updated_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `music_collections` (
	`id`,
	`title`,
	`cover`,
	`created_at`,
	`updated_at`,
	`item_count`,
	`source`,
	`source_id`
)
SELECT
	`id`,
	`title`,
	`cover`,
	`created_at`,
	`updated_at`,
	(
		SELECT COUNT(*)
		FROM `music_playlist_items` AS `items`
		WHERE `items`.`playlist_id` = `music_playlists`.`id`
	),
	'local',
	`id`
FROM `music_playlists`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `music_collection_items` (
	`collection_id` text NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`sort_order` integer,
	`added_at` integer,
	PRIMARY KEY(`collection_id`, `item_id`, `type`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `music_collection_items_sort_order_unq` ON `music_collection_items` (`collection_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_collection_items_item_id_idx` ON `music_collection_items` (`item_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `music_collection_items` (
	`collection_id`,
	`item_id`,
	`type`,
	`sort_order`,
	`added_at`
)
SELECT
	`playlist_id`,
	`audio_id`,
	'track',
	`position`,
	`created_at`
FROM `music_playlist_items`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `music_lyric_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`format` text NOT NULL,
	`translations` text,
	`updated_at` integer NOT NULL,
	`source` text,
	`offset_ms` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `music_lyric_entries_track_format_unq` ON `music_lyric_entries` (`track_id`,`format`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_lyric_entries_track_id_idx` ON `music_lyric_entries` (`track_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `music_lyric_entries` (
	`id`,
	`track_id`,
	`format`,
	`translations`,
	`updated_at`
)
SELECT
	MIN(`id`),
	`audio_id`,
	`format`,
	COALESCE(
		json_group_array(json_object('language', `language`, 'content', `content`)),
		json('[]')
	),
	MAX(`updated_at`)
FROM `music_lyrics`
GROUP BY `audio_id`, `format`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `music_track_play_statistics_details` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`played_at` integer NOT NULL,
	`played_duration_ms` integer NOT NULL,
	`position` integer,
	`completed` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_track_play_statistics_details_track_id_idx` ON `music_track_play_statistics_details` (`track_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `music_track_play_statistics_details_played_at_idx` ON `music_track_play_statistics_details` (`played_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `music_track_play_statistics_details` (
	`id`,
	`track_id`,
	`played_at`,
	`played_duration_ms`
)
SELECT
	`id`,
	`audio_id`,
	`played_at`,
	`duration`
FROM `music_play_statistics_details`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `music_track_play_statistics_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL UNIQUE,
	`play_count` integer DEFAULT 0 NOT NULL,
	`total_played_duration_ms` integer DEFAULT 0 NOT NULL,
	`last_played_at` integer
);
--> statement-breakpoint
INSERT OR IGNORE INTO `music_track_play_statistics_summaries` (
	`id`,
	`track_id`,
	`play_count`,
	`total_played_duration_ms`,
	`last_played_at`
)
SELECT
	`id`,
	`audio_id`,
	`play_count`,
	`total_played_duration`,
	`last_played_at`
FROM `music_play_statistics_summaries`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `plugin_sessions` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`is_logged_in` integer DEFAULT 0 NOT NULL,
	`user` text,
	`updated_at` integer NOT NULL
);
