import type {
  AudioAssets,
  AuthSession,
  LyricResult,
  MusicSourceCapabilities,
  MusicSourceContract,
  MusicSourcePluginMeta,
  Playlist,
  PluginErrorCode,
  PluginPlatform,
} from "@b_be_bee/models"
import type { NetworkRequest, NetworkResponse } from "@b_be_bee/network/types"

import type { PluginHostApi, PluginManifest, PluginModule } from "./manifest"

export type {
  AudioAssets,
  AuthSession,
  LyricResult,
  MusicSourceCapabilities,
  MusicSourcePluginMeta,
  Playlist,
  PluginErrorCode,
  PluginPlatform,
}

export interface PluginNetworkRequest extends NetworkRequest {
  useAuth?: boolean
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
  http: PluginHttpClient
  logger: PluginLogger
  platform: PluginPlatform
  appVersion: string
  host: PluginHostApi
}

export interface MusicSourcePlugin extends PluginModule, MusicSourceContract {
  meta: MusicSourcePluginMeta
  capabilities: MusicSourceCapabilities

  init(context: PluginContext): Promise<void>
  dispose?(): Promise<void>
}

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
  "getCurrentUser",
  "getHots",
  "getUserLibrary",
  "search",
  "trackToAudioPlayInfos",
  "getPersonAudioAsserts",
  "getAudioPlayInfo",
] as const satisfies readonly (keyof MusicSourcePlugin)[]

const capabilityMethods = {
  audioPlayInfo: ["trackToAudioPlayInfos", "getAudioPlayInfo"],
  auth: ["login", "logout", "getSession", "getCurrentUser"],
  collectionDetail: ["getCollectionDetail"],
  collectionTracks: ["getCollectionTracks"],
  cookieAuth: ["login", "logout", "getSession", "getCurrentUser"],
  hots: ["getHots"],
  lyrics: ["getLyrics"],
  personAudioAssets: ["getPersonAudioAsserts"],
  qualitySelect: ["getAvailableQualities"],
  search: ["search"],
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
