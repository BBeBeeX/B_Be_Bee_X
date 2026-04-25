CREATE TABLE `plugin_registry` (
  `id` text PRIMARY KEY NOT NULL,
  `manifest` text NOT NULL,
  `state` text NOT NULL,
  `source_kind` text NOT NULL,
  `plugin_type` text NOT NULL,
  `execution_model` text NOT NULL,
  `code_asset_id` text NOT NULL,
  `checksum` text NOT NULL,
  `signature` text NOT NULL,
  `signature_status` text NOT NULL,
  `last_error` text,
  `installed_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
