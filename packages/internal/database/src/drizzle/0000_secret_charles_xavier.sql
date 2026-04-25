
CREATE TABLE `images` (
	`url` text PRIMARY KEY NOT NULL,
	`colors` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `music_favorites` (
	`audio_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `music_lyrics` (
	`id` text PRIMARY KEY NOT NULL,
	`audio_id` text NOT NULL,
	`format` text NOT NULL,
	`language` text NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_lyrics_audio_format_language_unq` ON `music_lyrics` (`audio_id`,`format`,`language`);--> statement-breakpoint
CREATE INDEX `music_lyrics_audio_id_idx` ON `music_lyrics` (`audio_id`);--> statement-breakpoint
CREATE TABLE `music_play_statistics_details` (
	`id` text PRIMARY KEY NOT NULL,
	`audio_id` text NOT NULL,
	`played_at` integer NOT NULL,
	`duration` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `music_play_statistics_details_audio_id_idx` ON `music_play_statistics_details` (`audio_id`);--> statement-breakpoint
CREATE INDEX `music_play_statistics_details_played_at_idx` ON `music_play_statistics_details` (`played_at`);--> statement-breakpoint
CREATE TABLE `music_play_statistics_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`audio_id` text NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`total_played_duration` integer DEFAULT 0 NOT NULL,
	`last_played_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_play_statistics_summaries_audio_id_unique` ON `music_play_statistics_summaries` (`audio_id`);--> statement-breakpoint
CREATE TABLE `music_playlist_items` (
	`playlist_id` text NOT NULL,
	`audio_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`playlist_id`, `audio_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_playlist_items_position_unq` ON `music_playlist_items` (`playlist_id`,`position`);--> statement-breakpoint
CREATE INDEX `music_playlist_items_audio_id_idx` ON `music_playlist_items` (`audio_id`);--> statement-breakpoint
CREATE TABLE `music_playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cover` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `music_playlists_updated_at_idx` ON `music_playlists` (`updated_at`);--> statement-breakpoint
CREATE TABLE `music_songs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`cover` text,
	`upper` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`duration` integer NOT NULL,
	`music_title` text,
	`music_artist` text,
	`music_album` text,
	`source` text NOT NULL,
	`active_source` text,
	`online_id` text NOT NULL,
	`online_sub_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_songs_source_identity_unq` ON `music_songs` (`source`,`online_id`,`online_sub_id`);--> statement-breakpoint
CREATE INDEX `music_songs_source_idx` ON `music_songs` (`source`);--> statement-breakpoint
CREATE INDEX `music_songs_updated_at_idx` ON `music_songs` (`updated_at`);--> statement-breakpoint
CREATE TABLE `plugin_session_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_session_credentials_plugin_id_unq` ON `plugin_session_credentials` (`plugin_id`);--> statement-breakpoint
