# Music Source Plugin Prompt

Implement a TypeScript music source plugin for B_Be_Bee. The plugin type must be:

```ts
pluginTypes: ["music-source"]
```

The plugin provides network music data, login state, user library data, playable audio sources, lyrics, collections, people-related assets, and standardized errors.

## Required Capabilities

The plugin must declare:

```ts
interface MusicSourceCapabilities {
  auth: boolean
  search: boolean
  hots: boolean
  userLibrary: boolean
  collectionDetail: boolean
  collectionTracks: boolean
  lyrics: boolean
  audioPlayInfo: boolean
  qualitySelect: boolean
  personAudioAssets: boolean
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

All network requests must use `context.http`. Logs must use `context.logger`. Plugins do not receive a host storage API; session persistence is handled by the host. Do not directly access the file system, process globals, global cookies, undeclared network domains, or host internals.

## Login, Cookie, And Token Handling

The plugin must implement:

```ts
login(): Promise<AuthSession>
logout(): Promise<void>
getSession(): Promise<AuthSession | null>
getCurrentUser(): Promise<Person>
```

Login must return an `AuthSession` with Cookie or Token credentials when available. `getSession()` must return the current host-managed session state. `getCurrentUser()` must return the logged-in user as a `Person`. If a session is expired and `refreshSession()` exists, try to refresh it. After logout, user-only methods must throw `AUTH_REQUIRED`.

Requests that require login must call `context.http.request({ ..., useAuth: true })`. The host injects the current plugin session Cookie or Token into authenticated requests. Never log Cookie, Token, passwords, or authorization headers.

## Required Music APIs

`getHots(params?)` returns hot music assets as `AudioAssets`, where `tracks` is a paginated `Track` result and `audioInfos` is a paginated `Collection` result.

`search(keyword, type?, params?)` returns matching assets as `AudioAssets`. `type` may be `"track"`, `"album"`, `"artist"`, or `"all"`.

`getUserLibrary(params?)` returns the logged-in user's favorite/library `Collection` list. It must throw `AUTH_REQUIRED` when not logged in and `AUTH_EXPIRED` when the session is invalid.

`getCollectionDetail(id)` returns a complete `Collection` when the source supports collection detail loading. `getCollectionTracks(collection, params?)` returns paginated tracks for a collection.

`trackToAudioPlayInfos(track)` returns playable `AudioPlayInfo` for a `Track`.

`getPersonAudioAsserts(personId)` returns assets related to a person or artist as `AudioAssets`.

`getAudioPlayInfo(track, quality?)` returns `AudioPlayInfo`. If play URLs require headers, include `headers`. If play URLs expire, include `expiresAt`. If the source is blocked by region or copyright, throw `REGION_BLOCKED` or `COPYRIGHT_RESTRICTED`.

Optional APIs include `getCollectionDetail`, `getCollectionTracks`, `getAvailableQualities`, and `getLyrics`.

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
- Do not bypass the host HTTP client.
- Do not open external browsers without user confirmation.
- Do not keep using old Cookie or Token after logout.

## Acceptance Checklist

- `meta.pluginTypes` is exactly `["music-source"]`.
- `capabilities` is complete.
- `init(context)`, `login()`, `logout()`, `getSession()`, and `getCurrentUser()` are implemented.
- Login returns Cookie or Token credentials when available.
- `getSession()` returns the current host-managed session state.
- All network requests use `context.http`.
- Authenticated requests use `useAuth: true`.
- `getHots()`, `search()`, `getUserLibrary()`, `trackToAudioPlayInfos()`, `getPersonAudioAsserts()`, and `getAudioPlayInfo()` are implemented.
- List APIs support pagination.
- Play links include `headers` and `expiresAt` when required.
- Errors use `PluginError`.
- Sensitive data is not logged.
- Host permissions are not bypassed.
