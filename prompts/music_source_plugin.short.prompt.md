# Music Source Plugin Short Prompt

Implement a TypeScript music source plugin with `pluginTypes = ["music-source"]`.

The plugin must default-export an object compatible with `MusicSourcePlugin` from `@b_be_bee/plugin-sdk/music-source`.

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
```

Core rules:

- All network requests must go through `context.http`.
- Plugins do not receive a host storage API.
- Return Cookie or Token credentials from `login()` when available.
- Return the current host-managed session through `getSession()`.
- Return the logged-in user from `getCurrentUser()`.
- Requests that need login must use `useAuth: true`.
- `getHots()` returns hot music assets as `AudioAssets`.
- `search()` returns matching `AudioAssets` for `"track"`, `"album"`, `"artist"`, or `"all"`.
- `getUserLibrary()` returns the logged-in user's favorite/library `Collection` list.
- `getCollectionTracks()` returns tracks for a collection when `collectionTracks` capability is enabled.
- `trackToAudioPlayInfos()` returns playable `AudioPlayInfo` for a `Track`.
- `getPersonAudioAsserts()` returns assets related to a person or artist.
- `getAudioPlayInfo()` returns playable `AudioPlayInfo` for a `Track`.
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
