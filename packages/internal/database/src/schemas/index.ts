import { sql } from "drizzle-orm"
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import type {
  Album,
  AvailabilityReason,
  CollectionItemType,
  LyricInfo,
  LyricTranslation,
  Person,
  PluginErrorRecord,
  PluginExecutionModel,
  PluginManifest,
  PluginSignatureStatus,
  PluginSession,
  PluginSourceKind,
  PluginState,
  PluginType,
} from "@b_be_bee/models"

export type {
  InstalledPluginMetadata,
  PluginErrorRecord,
  PluginExecutionModel,
  PluginLifecyclePhase,
  PluginManifest,
  PluginManifestPermissions,
  PluginSignatureStatus,
  PluginSourceKind,
  PluginState,
  PluginType,
} from "@b_be_bee/models"

import type { ImageColorsResult } from "./types"

export const syncStates = [
  "local_only",
  "synced",
  "pending",
  "failed",
  "conflict",
] as const

export type SyncState = (typeof syncStates)[number]

export enum SyncStateEnum {
  localOnly = "local_only",
  synced = "synced",
  pending = "pending",
  failed = "failed",
  conflict = "conflict",
}

export const playSourceCacheStatuses = ["valid", "stale", "error", "invalid"] as const
export type PlaySourceCacheStatus = (typeof playSourceCacheStatuses)[number]

export const importJobStatuses = [
  "pending",
  "running",
  "paused",
  "failed",
  "completed",
  "cancelled",
] as const
export type ImportJobStatus = (typeof importJobStatuses)[number]

export const localFileStatuses = ["indexed", "missing", "removed", "error"] as const
export type LocalFileStatus = (typeof localFileStatuses)[number]

export const settingValueTypes = ["string", "number", "boolean", "json", "null"] as const
export type SettingValueType = (typeof settingValueTypes)[number]

export interface SyncMetadata {
  syncState: SyncState
  dirty: boolean
  lastSyncedAt?: number | null
}

export interface EncryptedPluginCredentialPayload {
  algorithm: "AES-GCM"
  iv: string
  data: string
}

export interface PersistedProxySettings {
  enabled: boolean
  protocol: "http" | "https" | "socks4" | "socks5"
  host: string
  port: number
  requireProxy?: boolean
  bypassHosts?: string[]
}

export interface PluginAccountProfile {
  label?: string | null
  avatar?: string | null
  user?: Person | null
  raw?: unknown
}

export interface PluginSessionState {
  activeAccountId?: string | null
  label?: string | null
  avatar?: string | null
  user?: Person | null
  raw?: unknown
}

export interface ImportJobProgress {
  total?: number
  completed?: number
  failed?: number
  skipped?: number
}

export interface ImportJobSummary {
  warnings?: string[]
  duplicates?: string[]
  errors?: string[]
  raw?: unknown
}

export interface LocalFileMetadata {
  mimeType?: string | null
  fingerprint?: string | null
  raw?: unknown
}

export interface PlaybackQueueState {
  currentIndex?: number | null
  label?: string | null
  raw?: unknown
}

export interface SettingValuePayload {
  value: unknown
}

export const imagesTable = sqliteTable("images", {
  url: text("url").notNull().primaryKey(),
  colors: text("colors", { mode: "json" }).$type<ImageColorsResult>().notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
})

export const tracksTable = sqliteTable(
  "music_tracks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    cover: text("cover"),
    creator: text("creator", { mode: "json" }).$type<Person | null>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    artists: text("artists", { mode: "json" }).$type<Person[] | null>(),
    album: text("album", { mode: "json" }).$type<Album | null>(),
    source: text("source").notNull(),
    activeSource: text("active_source"),
    sourceId: text("source_id").notNull(),
    sourceSubId: text("source_sub_id"),
    raw: text("raw", { mode: "json" }).$type<unknown>(),
    available: integer("available", { mode: "boolean" }),
    availabilityReason: text("availability_reason").$type<AvailabilityReason>(),
    description: text("description"),
    tags: text("tags", { mode: "json" }).$type<string[] | null>(),
    deletedAt: integer("deleted_at"),
    syncState: text("sync_state").$type<SyncState>().notNull().default(SyncStateEnum.localOnly),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [
    uniqueIndex("music_tracks_source_identity_unq").on(
      table.source,
      table.sourceId,
      table.sourceSubId,
    ),
    index("music_tracks_source_idx").on(table.source),
    index("music_tracks_updated_at_idx").on(table.updatedAt),
    index("music_tracks_deleted_at_idx").on(table.deletedAt),
    index("music_tracks_sync_state_idx").on(table.syncState),
  ],
)

export const collectionsTable = sqliteTable(
  "music_collections",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    cover: text("cover"),
    creator: text("creator", { mode: "json" }).$type<Person | null>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isTop: integer("is_top", { mode: "boolean" }).notNull().default(false),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    itemCount: integer("item_count"),
    source: text("source").notNull(),
    activeSource: text("active_source"),
    sourceId: text("source_id").notNull(),
    sourceSubId: text("source_sub_id"),
    raw: text("raw", { mode: "json" }).$type<unknown>(),
    available: integer("available", { mode: "boolean" }),
    availabilityReason: text("availability_reason").$type<AvailabilityReason>(),
    deletedAt: integer("deleted_at"),
    syncState: text("sync_state").$type<SyncState>().notNull().default(SyncStateEnum.localOnly),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [
    uniqueIndex("music_collections_source_identity_unq").on(
      table.source,
      table.sourceId,
      table.sourceSubId,
    ),
    index("music_collections_source_idx").on(table.source),
    index("music_collections_updated_at_idx").on(table.updatedAt),
    index("music_collections_deleted_at_idx").on(table.deletedAt),
    index("music_collections_sync_state_idx").on(table.syncState),
  ],
)

export const collectionItemsTable = sqliteTable(
  "music_collection_items",
  {
    collectionId: text("collection_id").notNull(),
    itemId: text("item_id").notNull(),
    type: text("type").$type<CollectionItemType>().notNull(),
    sortOrder: integer("sort_order"),
    addedAt: integer("added_at"),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.itemId, table.type] }),
    uniqueIndex("music_collection_items_sort_order_unq").on(table.collectionId, table.sortOrder),
    index("music_collection_items_item_id_idx").on(table.itemId),
  ],
)

export const musicFavoritesTable = sqliteTable("music_favorites", {
  audioId: text("audio_id").primaryKey(),
  createdAt: integer("created_at").notNull(),
})

export const lyricsTable = sqliteTable(
  "music_lyric_entries",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id").notNull(),
    format: text("format").notNull().$type<LyricInfo["format"]>(),
    translations: text("translations", { mode: "json" }).$type<LyricTranslation[] | null>(),
    updatedAt: integer("updated_at").notNull(),
    source: text("source"),
    offsetMs: integer("offset_ms"),
    deletedAt: integer("deleted_at"),
    syncState: text("sync_state").$type<SyncState>().notNull().default(SyncStateEnum.localOnly),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [
    uniqueIndex("music_lyric_entries_track_format_unq").on(table.trackId, table.format),
    index("music_lyric_entries_track_id_idx").on(table.trackId),
    index("music_lyric_entries_deleted_at_idx").on(table.deletedAt),
    index("music_lyric_entries_sync_state_idx").on(table.syncState),
  ],
)

export const playStatisticsDetailsTable = sqliteTable(
  "music_track_play_statistics_details",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id").notNull(),
    playedAt: integer("played_at").notNull(),
    playedDurationMs: integer("played_duration_ms").notNull(),
    position: integer("position"),
    completed: integer("completed", { mode: "boolean" }),
  },
  (table) => [
    index("music_track_play_statistics_details_track_id_idx").on(table.trackId),
    index("music_track_play_statistics_details_played_at_idx").on(table.playedAt),
  ],
)

export const playStatisticsSummariesTable = sqliteTable(
  "music_track_play_statistics_summaries",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id").notNull().unique(),
    playCount: integer("play_count").notNull().default(0),
    totalPlayedDurationMs: integer("total_played_duration_ms").notNull().default(0),
    lastPlayedAt: integer("last_played_at"),
  },
)

export const playSourceCachesTable = sqliteTable(
  "play_source_caches",
  {
    cacheKey: text("cache_key").primaryKey(),
    trackId: text("track_id").notNull(),
    source: text("source").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("play_source_caches_track_id_idx").on(table.trackId),
    index("play_source_caches_source_idx").on(table.source),
  ],
)

export const playSourceCacheStatusesTable = sqliteTable(
  "play_source_cache_statuses",
  {
    cacheKey: text("cache_key").primaryKey(),
    status: text("status").$type<PlaySourceCacheStatus>().notNull(),
    expiresAt: integer("expires_at"),
    error: text("error"),
    checkedAt: integer("checked_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("play_source_cache_statuses_status_idx").on(table.status),
    index("play_source_cache_statuses_expires_at_idx").on(table.expiresAt),
  ],
)

export const pluginAccountsTable = sqliteTable(
  "plugin_accounts",
  {
    id: text("id").primaryKey(),
    pluginId: text("plugin_id").notNull(),
    accountId: text("account_id").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    isLoggedIn: integer("is_logged_in", { mode: "boolean" }).notNull().default(false),
    profile: text("profile", { mode: "json" }).$type<PluginAccountProfile | null>(),
    updatedAt: integer("updated_at").notNull(),
    syncState: text("sync_state").$type<SyncState>().notNull().default(SyncStateEnum.localOnly),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [
    uniqueIndex("plugin_accounts_plugin_account_unq").on(table.pluginId, table.accountId),
    index("plugin_accounts_plugin_id_idx").on(table.pluginId),
    index("plugin_accounts_sync_state_idx").on(table.syncState),
  ],
)

export const pluginSessionsTable = sqliteTable(
  "plugin_sessions",
  {
    pluginId: text("plugin_id").primaryKey(),
    activeAccountId: text("active_account_id"),
    isLoggedIn: integer("is_logged_in", { mode: "boolean" }).notNull().default(false),
    state: text("state", { mode: "json" }).$type<PluginSessionState | null>(),
    updatedAt: integer("updated_at").notNull(),
    syncState: text("sync_state").$type<SyncState>().notNull().default(SyncStateEnum.localOnly),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [
    index("plugin_sessions_active_account_id_idx").on(table.activeAccountId),
    index("plugin_sessions_sync_state_idx").on(table.syncState),
  ],
)

export const pluginCredentialsTable = sqliteTable(
  "plugin_credentials",
  {
    id: text("id").primaryKey(),
    pluginId: text("plugin_id").notNull(),
    accountId: text("account_id"),
    encryptedPayload: text("encrypted_payload", { mode: "json" })
      .$type<EncryptedPluginCredentialPayload>()
      .notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("plugin_credentials_plugin_account_unq").on(table.pluginId, table.accountId),
    index("plugin_credentials_plugin_id_idx").on(table.pluginId),
  ],
)

export const importJobsTable = sqliteTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    sourceKind: text("source_kind").notNull(),
    status: text("status").$type<ImportJobStatus>().notNull(),
    progress: text("progress", { mode: "json" }).$type<ImportJobProgress | null>(),
    summary: text("summary", { mode: "json" }).$type<ImportJobSummary | null>(),
    startedAt: integer("started_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    index("import_jobs_status_idx").on(table.status),
    index("import_jobs_updated_at_idx").on(table.updatedAt),
  ],
)

export const localFilesTable = sqliteTable(
  "local_files",
  {
    id: text("id").primaryKey(),
    path: text("path").notNull(),
    uri: text("uri"),
    size: integer("size"),
    hash: text("hash"),
    createdAt: integer("created_at"),
    modifiedAt: integer("modified_at"),
    scannedAt: integer("scanned_at").notNull(),
    status: text("status").$type<LocalFileStatus>().notNull(),
    metadata: text("metadata", { mode: "json" }).$type<LocalFileMetadata | null>(),
    importJobId: text("import_job_id"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("local_files_path_unq").on(table.path),
    index("local_files_status_idx").on(table.status),
    index("local_files_hash_idx").on(table.hash),
  ],
)

export const localFileTrackLinksTable = sqliteTable(
  "local_file_track_links",
  {
    localFileId: text("local_file_id").notNull(),
    trackId: text("track_id").notNull(),
    linkedAt: integer("linked_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.localFileId, table.trackId] }),
    index("local_file_track_links_track_id_idx").on(table.trackId),
  ],
)

export const playbackQueuesTable = sqliteTable(
  "playback_queues",
  {
    id: text("id").primaryKey(),
    state: text("state", { mode: "json" }).$type<PlaybackQueueState | null>(),
    updatedAt: integer("updated_at").notNull(),
    syncState: text("sync_state").$type<SyncState>().notNull().default(SyncStateEnum.localOnly),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [index("playback_queues_sync_state_idx").on(table.syncState)],
)

export const playbackQueueItemsTable = sqliteTable(
  "playback_queue_items",
  {
    queueId: text("queue_id").notNull(),
    position: integer("position").notNull(),
    trackId: text("track_id"),
    source: text("source"),
    payload: text("payload", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
    syncState: text("sync_state").$type<SyncState>().notNull().default(SyncStateEnum.localOnly),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [
    primaryKey({ columns: [table.queueId, table.position] }),
    index("playback_queue_items_track_id_idx").on(table.trackId),
  ],
)

export const settingsTable = sqliteTable(
  "settings",
  {
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    valueType: text("value_type").$type<SettingValueType>().notNull(),
    value: text("value", { mode: "json" }).$type<SettingValuePayload | null>(),
    updatedAt: integer("updated_at").notNull(),
    syncState: text("sync_state").$type<SyncState>().notNull().default(SyncStateEnum.localOnly),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [
    primaryKey({ columns: [table.namespace, table.key] }),
    index("settings_sync_state_idx").on(table.syncState),
  ],
)

export const networkGlobalProxySettingsTable = sqliteTable("network_global_proxy_settings", {
  id: text("id").primaryKey(),
  settings: text("settings", { mode: "json" }).$type<PersistedProxySettings>().notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const networkPluginProxySettingsTable = sqliteTable("network_plugin_proxy_settings", {
  pluginId: text("plugin_id").primaryKey(),
  settings: text("settings", { mode: "json" }).$type<PersistedProxySettings>().notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const pluginRegistryTable = sqliteTable("plugin_registry", {
  id: text("id").primaryKey(),
  manifest: text("manifest", { mode: "json" }).$type<PluginManifest>().notNull(),
  state: text("state").$type<PluginState>().notNull(),
  sourceKind: text("source_kind").$type<PluginSourceKind>().notNull(),
  pluginType: text("plugin_type").$type<PluginType>().notNull(),
  executionModel: text("execution_model").$type<PluginExecutionModel>().notNull(),
  codeAssetId: text("code_asset_id").notNull(),
  checksum: text("checksum").notNull(),
  signature: text("signature").notNull(),
  signatureStatus: text("signature_status").$type<PluginSignatureStatus>().notNull(),
  lastError: text("last_error", { mode: "json" }).$type<PluginErrorRecord | null>(),
  installedAt: integer("installed_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

// Compatibility aliases for legacy imports while consumers migrate to the model vocabulary.
export const musicSongsTable = tracksTable
export const musicPlaylistsTable = collectionsTable
export const musicPlaylistItemsTable = collectionItemsTable
export const musicLyricsTable = lyricsTable
export const musicPlayStatisticsDetailsTable = playStatisticsDetailsTable
export const musicPlayStatisticsSummariesTable = playStatisticsSummariesTable
export const pluginSessionCredentialsTable = pluginCredentialsTable
