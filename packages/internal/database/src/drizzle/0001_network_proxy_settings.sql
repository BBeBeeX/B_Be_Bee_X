CREATE TABLE `network_global_proxy_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `settings` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `network_plugin_proxy_settings` (
  `plugin_id` text PRIMARY KEY NOT NULL,
  `settings` text NOT NULL,
  `updated_at` integer NOT NULL
);
