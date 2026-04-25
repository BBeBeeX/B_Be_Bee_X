import type {
  CollectionItemSchema,
  CollectionSchema,
  FavoriteSchema,
  ImageSchema,
  ImportJobSchema,
  LocalFileSchema,
  LocalFileTrackLinkSchema,
  LyricSchema,
  PlaybackQueueItemSchema,
  PlaybackQueueSchema,
  PlaySourceCacheSchema,
  PlaySourceCacheStatusSchema,
  PlayStatisticsDetailSchema,
  PlayStatisticsSummarySchema,
  PluginAccountSchema,
  PluginRegistrySchema,
  SettingSchema,
  TrackSchema,
} from "../../src/schemas/types"
import type { InstalledPluginMetadata, PersistedProxySettings } from "../../src/schemas"
import type { PluginSession, PluginSessionCredentials } from "@b_be_bee/models"

let idCounter = 0

function nextId(prefix: string) {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

export function createTrack(overrides: Partial<TrackSchema> = {}): TrackSchema {
  const id = overrides.id ?? nextId("track")
  return {
    id,
    title: overrides.title ?? `${id} title`,
    cover: overrides.cover ?? null,
    creator: overrides.creator ?? null,
    createdAt: overrides.createdAt ?? 1_700_000_000_000,
    updatedAt: overrides.updatedAt ?? 1_700_000_000_100,
    durationMs: overrides.durationMs ?? 180_000,
    artists: overrides.artists ?? null,
    album: overrides.album ?? null,
    source: overrides.source ?? "plugin-a",
    activeSource: overrides.activeSource ?? null,
    sourceId: overrides.sourceId ?? `${id}-source`,
    sourceSubId: overrides.sourceSubId ?? null,
    raw: overrides.raw ?? null,
    available: overrides.available ?? true,
    availabilityReason: overrides.availabilityReason,
    description: overrides.description ?? null,
    tags: overrides.tags ?? ["tag"],
    deletedAt: overrides.deletedAt ?? null,
    syncState: overrides.syncState ?? "local_only",
    dirty: overrides.dirty ?? false,
    lastSyncedAt: overrides.lastSyncedAt ?? null,
  }
}

export function createCollection(overrides: Partial<CollectionSchema> = {}): CollectionSchema {
  const id = overrides.id ?? nextId("collection")
  return {
    id,
    title: overrides.title ?? `${id} title`,
    cover: overrides.cover ?? null,
    creator: overrides.creator ?? null,
    createdAt: overrides.createdAt ?? 1_700_000_001_000,
    updatedAt: overrides.updatedAt ?? 1_700_000_001_100,
    isTop: overrides.isTop ?? false,
    isDefault: overrides.isDefault ?? false,
    itemCount: overrides.itemCount ?? 0,
    source: overrides.source ?? "plugin-a",
    activeSource: overrides.activeSource ?? null,
    sourceId: overrides.sourceId ?? `${id}-source`,
    sourceSubId: overrides.sourceSubId ?? null,
    raw: overrides.raw ?? null,
    available: overrides.available ?? true,
    availabilityReason: overrides.availabilityReason,
    deletedAt: overrides.deletedAt ?? null,
    syncState: overrides.syncState ?? "local_only",
    dirty: overrides.dirty ?? false,
    lastSyncedAt: overrides.lastSyncedAt ?? null,
  }
}

export function createCollectionItem(
  collectionId: string,
  overrides: Partial<CollectionItemSchema> = {},
): CollectionItemSchema {
  return {
    collectionId,
    itemId: overrides.itemId ?? nextId("item"),
    type: overrides.type ?? "track",
    sortOrder: overrides.sortOrder ?? 0,
    addedAt: overrides.addedAt ?? 1_700_000_001_500,
  }
}

export function createLyric(overrides: Partial<LyricSchema> = {}): LyricSchema {
  return {
    id: overrides.id ?? nextId("lyric"),
    trackId: overrides.trackId ?? nextId("track-ref"),
    format: overrides.format ?? "lrc",
    translations: overrides.translations ?? null,
    updatedAt: overrides.updatedAt ?? 1_700_000_002_000,
    source: overrides.source ?? "plugin-a",
    offsetMs: overrides.offsetMs ?? 0,
    deletedAt: overrides.deletedAt ?? null,
    syncState: overrides.syncState ?? "local_only",
    dirty: overrides.dirty ?? false,
    lastSyncedAt: overrides.lastSyncedAt ?? null,
  }
}

export function createFavorite(overrides: Partial<FavoriteSchema> = {}): FavoriteSchema {
  return {
    audioId: overrides.audioId ?? nextId("favorite"),
    createdAt: overrides.createdAt ?? 1_700_000_003_000,
  }
}

export function createImage(overrides: Partial<ImageSchema> = {}): ImageSchema {
  return {
    url: overrides.url ?? `https://example.com/${nextId("image")}.jpg`,
    colors: overrides.colors ?? {
      dominant: "#000000",
      vibrant: "#111111",
      darkVibrant: "#222222",
      lightVibrant: "#333333",
      darkMuted: "#444444",
      lightMuted: "#555555",
      muted: "#666666",
      platform: "web",
    },
    createdAt: overrides.createdAt ?? 1_700_000_004_000,
  }
}

export function createPlayDetail(overrides: Partial<PlayStatisticsDetailSchema> = {}): PlayStatisticsDetailSchema {
  return {
    id: overrides.id ?? nextId("play-detail"),
    trackId: overrides.trackId ?? nextId("track-ref"),
    playedAt: overrides.playedAt ?? 1_700_000_005_000,
    playedDurationMs: overrides.playedDurationMs ?? 20_000,
    position: overrides.position ?? 10_000,
    completed: overrides.completed ?? false,
  }
}

export function createPlaySummary(
  overrides: Partial<PlayStatisticsSummarySchema> = {},
): PlayStatisticsSummarySchema {
  const trackId = overrides.trackId ?? nextId("track-ref")
  return {
    id: overrides.id ?? trackId,
    trackId,
    playCount: overrides.playCount ?? 1,
    totalPlayedDurationMs: overrides.totalPlayedDurationMs ?? 20_000,
    lastPlayedAt: overrides.lastPlayedAt ?? 1_700_000_005_000,
  }
}

export function createCachePayload(overrides: Partial<PlaySourceCacheSchema> = {}): PlaySourceCacheSchema {
  return {
    cacheKey: overrides.cacheKey ?? nextId("cache"),
    trackId: overrides.trackId ?? nextId("track-ref"),
    source: overrides.source ?? "plugin-a",
    payload: overrides.payload ?? { url: "https://cdn.example.com/play" },
    updatedAt: overrides.updatedAt ?? 1_700_000_006_000,
  }
}

export function createCacheStatus(
  cacheKey: string,
  overrides: Partial<PlaySourceCacheStatusSchema> = {},
): PlaySourceCacheStatusSchema {
  return {
    cacheKey,
    status: overrides.status ?? "valid",
    expiresAt: overrides.expiresAt ?? Date.now() + 60_000,
    error: overrides.error ?? null,
    checkedAt: overrides.checkedAt ?? 1_700_000_006_100,
    updatedAt: overrides.updatedAt ?? 1_700_000_006_100,
  }
}

export function createImportJob(overrides: Partial<ImportJobSchema> = {}): ImportJobSchema {
  return {
    id: overrides.id ?? nextId("job"),
    sourceKind: overrides.sourceKind ?? "local",
    status: overrides.status ?? "pending",
    progress: overrides.progress ?? { total: 10, completed: 0, failed: 0, skipped: 0 },
    summary: overrides.summary ?? null,
    startedAt: overrides.startedAt ?? 1_700_000_007_000,
    updatedAt: overrides.updatedAt ?? 1_700_000_007_100,
    finishedAt: overrides.finishedAt ?? null,
  }
}

export function createLocalFile(overrides: Partial<LocalFileSchema> = {}): LocalFileSchema {
  const id = overrides.id ?? nextId("file")
  return {
    id,
    path: overrides.path ?? `C:/music/${id}.mp3`,
    uri: overrides.uri ?? `file:///music/${id}.mp3`,
    size: overrides.size ?? 2048,
    hash: overrides.hash ?? `${id}-hash`,
    createdAt: overrides.createdAt ?? 1_700_000_008_000,
    modifiedAt: overrides.modifiedAt ?? 1_700_000_008_050,
    scannedAt: overrides.scannedAt ?? 1_700_000_008_100,
    status: overrides.status ?? "indexed",
    metadata: overrides.metadata ?? { mimeType: "audio/mpeg", fingerprint: `${id}-fp` },
    importJobId: overrides.importJobId ?? null,
    updatedAt: overrides.updatedAt ?? 1_700_000_008_200,
  }
}

export function createLocalFileLink(
  localFileId: string,
  trackId: string,
  overrides: Partial<LocalFileTrackLinkSchema> = {},
): LocalFileTrackLinkSchema {
  return {
    localFileId,
    trackId,
    linkedAt: overrides.linkedAt ?? 1_700_000_008_300,
  }
}

export function createPlaybackQueue(overrides: Partial<PlaybackQueueSchema> = {}): PlaybackQueueSchema {
  return {
    id: overrides.id ?? "ignored",
    state: overrides.state ?? { currentIndex: 0, label: "默认队列" },
    updatedAt: overrides.updatedAt ?? 1_700_000_009_000,
    syncState: overrides.syncState ?? "local_only",
    dirty: overrides.dirty ?? false,
    lastSyncedAt: overrides.lastSyncedAt ?? null,
  }
}

export function createPlaybackQueueItem(
  overrides: Partial<PlaybackQueueItemSchema> = {},
): PlaybackQueueItemSchema {
  return {
    queueId: overrides.queueId ?? "ignored",
    position: overrides.position ?? 0,
    trackId: overrides.trackId ?? nextId("track-ref"),
    source: overrides.source ?? "plugin-a",
    payload: overrides.payload ?? { from: "test" },
    updatedAt: overrides.updatedAt ?? 1_700_000_009_100,
    syncState: overrides.syncState ?? "local_only",
    dirty: overrides.dirty ?? false,
    lastSyncedAt: overrides.lastSyncedAt ?? null,
  }
}

export function createSetting(overrides: Partial<SettingSchema> = {}): SettingSchema {
  return {
    namespace: overrides.namespace ?? "player",
    key: overrides.key ?? nextId("setting"),
    valueType: overrides.valueType ?? "json",
    value: overrides.value ?? { value: { enabled: true } },
    updatedAt: overrides.updatedAt ?? 1_700_000_010_000,
    syncState: overrides.syncState ?? "local_only",
    dirty: overrides.dirty ?? false,
    lastSyncedAt: overrides.lastSyncedAt ?? null,
  }
}

export function createProxySettings(
  overrides: Partial<PersistedProxySettings> = {},
): PersistedProxySettings {
  return {
    enabled: overrides.enabled ?? true,
    protocol: overrides.protocol ?? "http",
    host: overrides.host ?? "127.0.0.1",
    port: overrides.port ?? 7890,
    requireProxy: overrides.requireProxy ?? false,
    bypassHosts: overrides.bypassHosts ?? ["localhost"],
  }
}

export function createPluginSession(overrides: Partial<PluginSession> = {}): PluginSession {
  return {
    pluginId: overrides.pluginId ?? "plugin-a",
    isLoggedIn: overrides.isLoggedIn ?? true,
    updatedAt: overrides.updatedAt ?? 1_700_000_011_000,
    credentials: overrides.credentials ?? { userId: "user-1", username: "alice" },
    user: overrides.user ?? { id: "user-1", name: "Alice", avatar: "https://example.com/a.png" },
  }
}

export function createPluginCredentials(
  overrides: Partial<PluginSessionCredentials> = {},
): PluginSessionCredentials {
  return {
    userId: overrides.userId ?? "user-1",
    username: overrides.username ?? "alice",
    cookie: overrides.cookie ?? "sid=1",
    token: overrides.token ?? "token-1",
    refreshToken: overrides.refreshToken ?? "refresh-1",
    expiresAt: overrides.expiresAt ?? 1_700_000_012_000,
    headers: overrides.headers ?? { authorization: "Bearer token-1" },
  }
}

export function createPluginAccount(overrides: Partial<PluginAccountSchema> = {}): PluginAccountSchema {
  return {
    id: overrides.id ?? nextId("plugin-account"),
    pluginId: overrides.pluginId ?? "plugin-a",
    accountId: overrides.accountId ?? nextId("account"),
    isDefault: overrides.isDefault ?? false,
    isLoggedIn: overrides.isLoggedIn ?? true,
    profile: overrides.profile ?? { label: "Alice", avatar: "https://example.com/a.png" },
    updatedAt: overrides.updatedAt ?? 1_700_000_013_000,
    syncState: overrides.syncState ?? "local_only",
    dirty: overrides.dirty ?? false,
    lastSyncedAt: overrides.lastSyncedAt ?? null,
  }
}

export function createPluginRegistryMetadata(
  overrides: Partial<InstalledPluginMetadata> = {},
): InstalledPluginMetadata {
  const id = overrides.id ?? nextId("plugin")
  return {
    id,
    manifest: overrides.manifest ?? {
      id,
      name: `Plugin ${id}`,
      version: "1.0.0",
      apiVersion: "1",
      minAppVersion: "1.0.0",
      type: "music-source",
      executionModel: "worker",
      capabilities: ["search"],
      scopes: ["library:read"],
      permissions: {
        auth: true,
        network: ["https://example.com"],
        proxy: false,
        storage: [],
      },
      checksum: "checksum",
      signature: "signature",
    },
    state: overrides.state ?? "enabled",
    sourceKind: overrides.sourceKind ?? "zip",
    codeAssetId: overrides.codeAssetId ?? `${id}-asset`,
    checksum: overrides.checksum ?? "checksum",
    signature: overrides.signature ?? "signature",
    signatureStatus: overrides.signatureStatus ?? "verified",
    installedAt: overrides.installedAt ?? 1_700_000_014_000,
    updatedAt: overrides.updatedAt ?? 1_700_000_014_100,
    lastError: overrides.lastError ?? null,
  }
}

export function toPluginRegistryRow(
  overrides: Partial<PluginRegistrySchema> = {},
): PluginRegistrySchema {
  const metadata = createPluginRegistryMetadata({
    id: overrides.id,
    updatedAt: overrides.updatedAt,
    state: overrides.state,
  })

  return {
    id: metadata.id,
    manifest: overrides.manifest ?? metadata.manifest,
    state: overrides.state ?? metadata.state,
    sourceKind: overrides.sourceKind ?? metadata.sourceKind,
    pluginType: overrides.pluginType ?? metadata.manifest.type,
    executionModel: overrides.executionModel ?? metadata.manifest.executionModel,
    codeAssetId: overrides.codeAssetId ?? metadata.codeAssetId,
    checksum: overrides.checksum ?? metadata.checksum,
    signature: overrides.signature ?? metadata.signature,
    signatureStatus: overrides.signatureStatus ?? metadata.signatureStatus,
    lastError: overrides.lastError ?? metadata.lastError,
    installedAt: overrides.installedAt ?? metadata.installedAt,
    updatedAt: overrides.updatedAt ?? metadata.updatedAt,
  }
}
