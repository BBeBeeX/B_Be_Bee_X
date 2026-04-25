import type {
  collectionItemsTable,
  collectionsTable,
  imagesTable,
  importJobsTable,
  localFilesTable,
  localFileTrackLinksTable,
  lyricsTable,
  musicFavoritesTable,
  networkGlobalProxySettingsTable,
  networkPluginProxySettingsTable,
  playbackQueueItemsTable,
  playbackQueuesTable,
  playSourceCachesTable,
  playSourceCacheStatusesTable,
  playStatisticsDetailsTable,
  playStatisticsSummariesTable,
  pluginAccountsTable,
  pluginCredentialsTable,
  pluginRegistryTable,
  pluginSessionsTable,
  settingsTable,
  tracksTable,
} from "."

export type ImageSchema = typeof imagesTable.$inferInsert

export type TrackSchema = typeof tracksTable.$inferInsert
export type CollectionSchema = typeof collectionsTable.$inferInsert
export type CollectionItemSchema = typeof collectionItemsTable.$inferInsert
export type FavoriteSchema = typeof musicFavoritesTable.$inferInsert
export type LyricSchema = typeof lyricsTable.$inferInsert
export type PlayStatisticsDetailSchema = typeof playStatisticsDetailsTable.$inferInsert
export type PlayStatisticsSummarySchema = typeof playStatisticsSummariesTable.$inferInsert
export type PlaySourceCacheSchema = typeof playSourceCachesTable.$inferInsert
export type PlaySourceCacheStatusSchema = typeof playSourceCacheStatusesTable.$inferInsert
export type PluginAccountSchema = typeof pluginAccountsTable.$inferInsert
export type PluginSessionSchema = typeof pluginSessionsTable.$inferInsert
export type PluginCredentialSchema = typeof pluginCredentialsTable.$inferInsert
export type ImportJobSchema = typeof importJobsTable.$inferInsert
export type LocalFileSchema = typeof localFilesTable.$inferInsert
export type LocalFileTrackLinkSchema = typeof localFileTrackLinksTable.$inferInsert
export type PlaybackQueueSchema = typeof playbackQueuesTable.$inferInsert
export type PlaybackQueueItemSchema = typeof playbackQueueItemsTable.$inferInsert
export type SettingSchema = typeof settingsTable.$inferInsert
export type NetworkGlobalProxySettingsSchema = typeof networkGlobalProxySettingsTable.$inferInsert
export type NetworkPluginProxySettingsSchema = typeof networkPluginProxySettingsTable.$inferInsert
export type PluginRegistrySchema = typeof pluginRegistryTable.$inferInsert

interface AndroidImageColors {
  dominant: string
  average: string
  vibrant: string
  darkVibrant: string
  lightVibrant: string
  darkMuted: string
  lightMuted: string
  muted: string
  platform: "android"
}

interface WebImageColors {
  dominant: string
  vibrant: string
  darkVibrant: string
  lightVibrant: string
  darkMuted: string
  lightMuted: string
  muted: string
  platform: "web"
}

interface IOSImageColors {
  background: string
  primary: string
  secondary: string
  detail: string
  platform: "ios"
}

export type ImageColorsResult = AndroidImageColors | IOSImageColors | WebImageColors
