# Music Source Plugin Short Prompt

Implement a TypeScript music source plugin with `pluginTypes = ["music-source"]`.

The plugin must default-export an object compatible with `MusicSourcePlugin` from `@b_be_bee/plugin/music-source`.

Required shape:

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

Core rules:

- All network requests must go through `context.http`.
- All local persistence must go through `context.storage`.
- Save Cookie or Token after login.
- Restore login state through `getSession()` on the next startup.
- Requests that need login must use `useAuth: true`.
- Logout must remove Cookie, Token, and user-related cache.
- `getHotTracks()` returns hot music as `Track` or `AudioInfo` page results.
- `getUserLibrary()` returns the logged-in user's favorite/library `Track` list.
- `trackToAudioInfo()` converts a `Track` to `AudioInfo`.
- `getAudioPlayInfo()` returns playable `AudioPlayInfo` for an `AudioInfo`.
- Play URLs that need headers must return `headers`.
- Expiring play URLs must return `expiresAt`.
- List APIs must support pagination.
- Convert failures to `PluginError`.
- Do not log Cookie or Token.
- Do not access the file system directly.
- Do not bypass the host HTTP client.
- Do not access undeclared network domains.

Use these error codes:

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
