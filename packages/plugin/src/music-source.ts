import type {
  AudioPlayInfo,
  AudioQuality,
  Collection,
  LyricInfo,
  PageParams,
  PageResult,
  PluginSession,
  Track,
} from "@b_be_bee/models"
import type { NetworkRequest, NetworkResponse } from "@b_be_bee/network/types"

import type { PluginHostApi, PluginManifest, PluginModule } from "./manifest"

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

export interface AudioInfo {
  id: string
  trackId: string
  source: string
  sourceId: string
  sourceSubId?: string | null
  title?: string | null
  quality?: AudioQuality
  raw?: unknown
}

export interface LyricResult {
  raw?: string
  lrc?: string
  translatedLrc?: string
  language?: string
  info?: LyricInfo
}

export interface PluginNetworkRequest extends NetworkRequest {
  useAuth?: boolean
}

export interface PluginStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
}

export interface PluginHttpClient {
  request<TData = unknown>(options: PluginNetworkRequest): Promise<NetworkResponse<TData>>
}

export interface PluginLogger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

export interface PluginContext {
  storage: PluginStorage
  http: PluginHttpClient
  logger: PluginLogger
  platform: PluginPlatform
  appVersion: string
  host: PluginHostApi
}

export interface MusicSourcePlugin extends PluginModule {
  meta: MusicSourcePluginMeta
  capabilities: MusicSourceCapabilities

  init(context: PluginContext): Promise<void>
  dispose?(): Promise<void>

  login(): Promise<AuthSession>
  logout(): Promise<void>
  getSession(): Promise<AuthSession | null>
  refreshSession?(): Promise<AuthSession>

  getHotTracks(params?: PageParams): Promise<PageResult<Track> | PageResult<AudioInfo>>
  searchTracks?(keyword: string, params?: PageParams): Promise<PageResult<Track>>

  getUserLibrary(params?: PageParams): Promise<PageResult<Track>>
  getUserPlaylists?(params?: PageParams): Promise<PageResult<Playlist>>
  getPlaylistTracks?(playlistId: string, params?: PageParams): Promise<PageResult<Track>>

  trackToAudioInfo(track: Track): Promise<AudioInfo>
  tracksToAudioInfos?(tracks: Track[]): Promise<AudioInfo[]>

  getAvailableQualities?(audio: AudioInfo): Promise<AudioQuality[]>
  getAudioPlayInfo(audio: AudioInfo, quality?: AudioQuality): Promise<AudioPlayInfo>

  getLyrics?(audio: AudioInfo): Promise<LyricResult | null>
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

export class PluginError extends Error {
  readonly code: PluginErrorCode
  readonly retryable?: boolean
  readonly detail?: unknown

  constructor(
    code: PluginErrorCode,
    message: string,
    options?: {
      retryable?: boolean
      detail?: unknown
    },
  ) {
    super(message)
    this.name = "PluginError"
    this.code = code
    this.retryable = options?.retryable
    this.detail = options?.detail
  }
}

const requiredMusicSourceMethods = [
  "init",
  "login",
  "logout",
  "getSession",
  "getHotTracks",
  "getUserLibrary",
  "trackToAudioInfo",
  "getAudioPlayInfo",
] as const satisfies readonly (keyof MusicSourcePlugin)[]

const capabilityMethods = {
  audioSource: ["trackToAudioInfo", "getAudioPlayInfo"],
  auth: ["login", "logout", "getSession"],
  cookieAuth: ["login", "logout", "getSession"],
  hotTracks: ["getHotTracks"],
  lyrics: ["getLyrics"],
  playlist: ["getUserPlaylists", "getPlaylistTracks"],
  qualitySelect: ["getAvailableQualities"],
  search: ["searchTracks"],
  userLibrary: ["getUserLibrary"],
} as const satisfies Record<keyof MusicSourceCapabilities, readonly (keyof MusicSourcePlugin)[]>

const isObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object"
}

const hasFunction = (value: Record<string, unknown>, key: string) => {
  return typeof value[key] === "function"
}

export const isMusicSourceCapabilities = (value: unknown): value is MusicSourceCapabilities => {
  if (!isObject(value)) return false
  return Object.keys(capabilityMethods).every((key) => typeof value[key] === "boolean")
}

export const isMusicSourcePlugin = (value: unknown): value is MusicSourcePlugin => {
  if (!isObject(value)) return false
  const meta = value.meta
  if (!isObject(meta)) return false
  if (
    !Array.isArray(meta.pluginTypes) ||
    meta.pluginTypes.length !== 1 ||
    meta.pluginTypes[0] !== "music-source"
  ) {
    return false
  }
  if (typeof meta.id !== "string" || typeof meta.name !== "string" || typeof meta.version !== "string") {
    return false
  }
  if (!isMusicSourceCapabilities(value.capabilities)) return false
  return requiredMusicSourceMethods.every((method) => hasFunction(value, method))
}

export const assertMusicSourcePlugin: (
  value: unknown,
  manifest?: PluginManifest,
) => asserts value is MusicSourcePlugin = (value, manifest) => {
  if (!isObject(value)) {
    throw new PluginError("INVALID_RESPONSE", "Music source plugin must export an object.")
  }
  if (!isMusicSourcePlugin(value)) {
    throw new PluginError(
      "INVALID_RESPONSE",
      "Music source plugin must provide meta, capabilities, and required music source methods.",
    )
  }
  if (manifest) {
    if (manifest.type !== "music-source") {
      throw new PluginError("INVALID_RESPONSE", "Music source plugin manifest type must be music-source.")
    }
    if (value.meta.id !== manifest.id || value.meta.version !== manifest.version) {
      throw new PluginError(
        "INVALID_RESPONSE",
        "Music source plugin meta id and version must match the manifest.",
      )
    }
  }

  const capabilities = value.capabilities
  for (const [capability, methods] of Object.entries(capabilityMethods)) {
    if (!capabilities[capability as keyof MusicSourceCapabilities]) continue
    const missing = methods.filter((method) => !hasFunction(value, method))
    if (missing.length > 0) {
      throw new PluginError(
        "INVALID_RESPONSE",
        `Music source capability ${capability} requires methods: ${missing.join(", ")}.`,
      )
    }
  }
}

export const validateMusicSourcePlugin = (
  value: unknown,
  manifest?: PluginManifest,
): MusicSourcePlugin => {
  assertMusicSourcePlugin(value, manifest)
  return value
}
