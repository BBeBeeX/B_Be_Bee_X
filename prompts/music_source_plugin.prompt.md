# Music Source Plugin Prompt

Implement a TypeScript music source plugin for B_Be_Bee. The plugin type must be:

```ts
pluginTypes: ["music-source"]
```

The plugin provides network music data, login state, user library data, playable audio sources, lyrics, playlists, and standardized errors.

## Required Capabilities

The plugin must declare:

```ts
interface MusicSourceCapabilities {
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
```

If a capability is `true`, the matching interface must be implemented. The host application uses `capabilities` to decide which UI features are available.

## Required Plugin Shape

Default-export a plugin object compatible with:

```ts
interface MusicSourcePlugin {
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
```

## Metadata

The plugin must provide:

```ts
interface MusicSourcePluginMeta {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  homepage?: string
  pluginTypes: ["music-source"]
  supportedPlatforms?: PluginPlatform[]
}
```

`id` must be globally unique. `version` should use semantic versioning. `pluginTypes` must contain only `"music-source"` for a music source plugin. Do not hardcode host private paths.

## Context

The host passes `PluginContext` to `init(context)`.

All network requests must use `context.http`. All persistence must use `context.storage`. Logs must use `context.logger`. Do not directly access the file system, process globals, global cookies, undeclared network domains, or host internals.

## Login, Cookie, And Token Handling

The plugin must implement:

```ts
login(): Promise<AuthSession>
logout(): Promise<void>
getSession(): Promise<AuthSession | null>
```

Login must save Cookie or Token in `context.storage`. `getSession()` must restore the saved session on the next startup. If a session is expired and `refreshSession()` exists, try to refresh it. Logout must remove Cookie, Token, and user-related cache. After logout, user-only methods must throw `AUTH_REQUIRED`.

Requests that require login must call `context.http.request({ ..., useAuth: true })`. The host injects the current plugin session Cookie or Token into authenticated requests. Never log Cookie, Token, passwords, or authorization headers.

## Required Music APIs

`getHotTracks(params?)` returns a paginated hot music list as `Track` or `AudioInfo` items.

`getUserLibrary(params?)` returns the logged-in user's favorite/library `Track` list. It must throw `AUTH_REQUIRED` when not logged in and `AUTH_EXPIRED` when the session is invalid.

`trackToAudioInfo(track)` converts a model `Track` into plugin-specific `AudioInfo`.

`getAudioPlayInfo(audio, quality?)` returns `AudioPlayInfo`. If play URLs require headers, include `headers`. If play URLs expire, include `expiresAt`. If the source is blocked by region or copyright, throw `REGION_BLOCKED` or `COPYRIGHT_RESTRICTED`.

Optional APIs include `searchTracks`, `getUserPlaylists`, `getPlaylistTracks`, `tracksToAudioInfos`, `getAvailableQualities`, and `getLyrics`.

## Pagination

All list APIs must support `PageParams` and return `PageResult<T>`. Set `hasMore` accurately and provide `nextCursor` for cursor-based APIs.

## Errors

Use `PluginError` and one of these codes:

```ts
type PluginErrorCode =
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
```

Do not throw raw upstream errors to the host UI. Convert network failures, invalid responses, rate limits, auth failures, source unavailability, and API changes into standardized errors.

## Security

- Do not log Cookie, Token, passwords, or authorization headers.
- Do not upload user data to undeclared domains.
- Do not access the file system directly.
- Do not execute dynamic remote code.
- Do not mutate host app configuration.
- Do not access another plugin's storage.
- Do not bypass the host HTTP client.
- Do not open external browsers without user confirmation.
- Do not keep using old Cookie or Token after logout.

## Acceptance Checklist

- `meta.pluginTypes` is exactly `["music-source"]`.
- `capabilities` is complete.
- `init(context)`, `login()`, `logout()`, and `getSession()` are implemented.
- Login saves Cookie or Token.
- Startup restores login state.
- Logout clears Cookie, Token, and user cache.
- All network requests use `context.http`.
- Authenticated requests use `useAuth: true`.
- `getHotTracks()`, `getUserLibrary()`, `trackToAudioInfo()`, and `getAudioPlayInfo()` are implemented.
- List APIs support pagination.
- Play links include `headers` and `expiresAt` when required.
- Errors use `PluginError`.
- Sensitive data is not logged.
- Host permissions are not bypassed.
