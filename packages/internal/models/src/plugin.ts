import type { AudioPlayInfo, Collection, Track } from "./music"
import type { AudioQuality } from "./enum"
import type { LyricInfo } from "./lyric"
import type { PageParams, PageResult, Person } from "./common"

export interface PluginSessionCredentials {
    cookie?: string;
    token?: string;
    refreshToken?: string;
    headers?: Record<string, string>;
    expiresAt?: number | null;
    userId?: string | null;
    username?: string | null;
}

export interface PluginSession {
    pluginId: string;
    isLoggedIn: boolean;
    credentials?: PluginSessionCredentials;
    user?: Person  | null;
    updatedAt: number;
}

export const pluginTypes = ["music-source", "ui-extension", "service"] as const
export const pluginExecutionModels = ["isolated-vm", "worker", "bridge"] as const
export const pluginStates = ["installed", "enabled", "loaded", "running", "error", "disabled"] as const
export const pluginSignatureStatuses = ["verified", "unverified", "blocked"] as const

export type PluginType = (typeof pluginTypes)[number]
export type PluginExecutionModel = (typeof pluginExecutionModels)[number]
export type PluginState = (typeof pluginStates)[number]
export type PluginSourceKind = "zip" | "single-file"
export type PluginSignatureStatus = (typeof pluginSignatureStatuses)[number]

export interface PluginManifestPermissions {
  network: string[]
  auth: boolean
  proxy: boolean
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: string
  minAppVersion: string
  type: PluginType
  executionModel: PluginExecutionModel
  capabilities: string[]
  scopes: string[]
  permissions: PluginManifestPermissions
  checksum: string
  signature: string
}

export type PluginLifecyclePhase =
  | "install"
  | "enable"
  | "load"
  | "run"
  | "api-call"
  | "event"
  | "disable"
  | "uninstall"
  | "update"

export interface PluginErrorRecord {
  message: string
  phase: PluginLifecyclePhase
  occurredAt: number
}

export interface InstalledPluginMetadata {
  id: string
  manifest: PluginManifest
  state: PluginState
  sourceKind: PluginSourceKind
  codeAssetId: string
  checksum: string
  signature: string
  signatureStatus: PluginSignatureStatus
  installedAt: number
  updatedAt: number
  lastError?: PluginErrorRecord | null
}

export type AuthSession = PluginSession
export type Playlist = Collection
export type PluginPlatform = "android" | "ios" | "windows" | "macos" | "linux" | "web"

export interface MusicSourceCapabilities {
  auth: boolean
  search: boolean
  hotTracks: boolean
  userLibrary: boolean
  playlist: boolean
  lyrics: boolean
  audioSource: boolean
  qualitySelect: boolean
  cookieAuth: boolean
}

export interface MusicSourcePluginMeta {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  homepage?: string
  pluginTypes: ["music-source"]
  supportedPlatforms?: PluginPlatform[]
}

export interface LyricResult {
  raw?: string
  lrc?: string
  translatedLrc?: string
  language?: string
  info?: LyricInfo
}

export interface AudioAssets {
  tracks: PageResult<Track>
  audioInfos: PageResult<Collection>
}

export type PluginErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "REGION_BLOCKED"
  | "COPYRIGHT_RESTRICTED"
  | "TRACK_NOT_FOUND"
  | "SOURCE_UNAVAILABLE"
  | "PLUGIN_API_CHANGED"
  | "INVALID_RESPONSE"
  | "UNKNOWN"

export interface MusicSourceContract {
  login(): Promise<AuthSession>
  logout(): Promise<void>
  getSession(): Promise<AuthSession | null>
  getCurrentUser(): Promise<Person>
  refreshSession?(): Promise<AuthSession>

  getHots(params?: PageParams): Promise<AudioAssets>
  search(keyword: string, type?: "track" | "album" | "artist" | "all", params?: PageParams): Promise<AudioAssets>

  getUserLibrary(params?: PageParams): Promise<PageResult<Collection>>

  getCollectionDetail?(id: string): Promise<Collection>
  getCollectionTracks?(collection: Collection, params?: PageParams): Promise<PageResult<Track>>
  trackToAudioPlayInfos(track: Track): Promise<AudioPlayInfo>
  getPersonAudioAsserts(personId: string): Promise<AudioAssets>

  getAvailableQualities?(track: Track): Promise<AudioQuality[]>
  getAudioPlayInfo(track: Track, quality?: AudioQuality): Promise<AudioPlayInfo>

  getLyrics?(track: Track): Promise<LyricResult | null>
}
