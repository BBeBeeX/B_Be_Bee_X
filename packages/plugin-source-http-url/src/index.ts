/**
 * `plugin-source-http-url` — a plain audio URL, as a provider.
 *
 * The SPI's floor: it implements the required core and **nothing** else. No
 * `search`, no `browse`, no `getAlbum`, no `library`. That is its value — if a
 * screen breaks with this configured, some consumer is calling an optional
 * member without checking `capabilities` (docs/06 §8).
 *
 * It is also the streaming path's only user in M1: a remote URL exercises the
 * buffering, stalling and seek-by-range behaviour that no local file can.
 */

import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { NetworkError, NotFoundError } from '@BBeBee/protocol'
import type {
  AuthStatus,
  Capabilities,
  Disposable,
  MediaProvider,
  ProviderAuth,
  StreamHandle,
  StreamPrefs,
  Track,
} from '@BBeBee/protocol'

export interface UrlEntry {
  /** Stable id; the URN's last segment. Defaults to a hash of the url. */
  id?: string
  url: string
  title?: string
  artist?: string
  durationMs?: number
}

export interface SourceHttpUrlConfig {
  instanceId?: string
  displayName?: string
  /** The URLs this instance serves. */
  entries?: UrlEntry[]
}

/**
 * Everything optional is `false`, and every optional member is absent.
 *
 * Under-declaring degrades the UI; over-declaring breaks it. This provider is
 * the check that the difference is respected.
 */
function capabilitiesFor(seekable: boolean): Capabilities {
  return {
    search: { tracks: false, albums: false, artists: false, playlists: false, fullText: false },
    browse: false,
    lyrics: false,
    artwork: false,
    library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
    streaming: {
      qualities: ['normal'],
      transcoding: false,
      // Learned from the server's `Accept-Ranges`, not assumed: a stream that
      // cannot be ranged cannot be seeked, and the UI hides the scrubber.
      seekable,
      urlExpiry: false,
    },
    regional: false,
  }
}

class NoAuth implements ProviderAuth {
  readonly flow = { kind: 'none' } as const
  status: AuthStatus = { state: 'authenticated' }
  private readonly listeners = new Set<(s: AuthStatus) => void>()

  async signIn(): Promise<void> {
    this.status = { state: 'authenticated' }
  }

  async signOut(): Promise<void> {
    this.status = { state: 'anonymous' }
    for (const listener of this.listeners) listener(this.status)
  }

  onStatusChange(cb: (s: AuthStatus) => void): Disposable {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

/**
 * Deliberately **not** a Cordis service.
 *
 * This provider is `instantiable`, and a service key is global: two configured
 * web addresses would be two plugins claiming `ctx.sourceHttpUrl`, and the
 * second would fail to load with "service has been registered". Instances are
 * reachable where they belong — through `ctx.sources.get(instanceId)` — which
 * is what the registry is for (docs/06 §2).
 */
export class SourceHttpUrl {
  private readonly instanceId: string
  private readonly displayName: string
  private readonly entries = new Map<string, UrlEntry & { id: string }>()
  private seekable = true

  constructor(
    private readonly ctx: Context,
    config: SourceHttpUrlConfig = {},
  ) {
    this.instanceId = config.instanceId ?? 'http-url'
    this.displayName = config.displayName ?? 'Web address'
    for (const entry of config.entries ?? []) {
      const id = entry.id ?? hash(entry.url)
      this.entries.set(id, { ...entry, id })
    }
  }

  provider(): MediaProvider {
    return {
      instanceId: this.instanceId,
      displayName: this.displayName,
      get capabilities() {
        return capabilitiesFor(true)
      },
      auth: new NoAuth(),
      getTrack: (id) => this.getTrack(id),
      resolveStream: (id, prefs) => this.resolveStream(id, prefs),
      ping: () => this.ping(),
      // Nothing else. Not stubbed, not throwing — absent.
    }
  }

  /** Add a URL at runtime, as the settings screen does. */
  add(entry: UrlEntry): string {
    const id = entry.id ?? hash(entry.url)
    this.entries.set(id, { ...entry, id })
    return `BBeBee:${this.instanceId}:track:${id}`
  }

  remove(id: string): void {
    this.entries.delete(id)
  }

  get urls(): readonly (UrlEntry & { id: string })[] {
    return [...this.entries.values()]
  }

  async getTrack(id: string): Promise<Track> {
    const entry = this.entries.get(id)
    if (!entry) throw new NotFoundError(`no url configured for ${id}`, this.instanceId)
    return {
      urn: `BBeBee:${this.instanceId}:track:${id}`,
      // A URL has no tags, so the title is the last path segment unless the
      // user named it. Guessing more than that would be inventing metadata.
      title: entry.title ?? lastSegment(entry.url),
      artists: entry.artist
        ? [{ urn: `BBeBee:${this.instanceId}:artist:${hash(entry.artist)}`, name: entry.artist, role: 'main', ordinal: 0 }]
        : [],
      ...(entry.durationMs ? { durationMs: entry.durationMs } : {}),
      available: true,
    }
  }

  async resolveStream(id: string, _prefs: StreamPrefs): Promise<StreamHandle> {
    const entry = this.entries.get(id)
    if (!entry) throw new NotFoundError(`no url configured for ${id}`, this.instanceId)

    // A HEAD tells us whether the server will honour a Range — which is
    // whether this track can be seeked at all.
    let byteLength: number | undefined
    let mimeType: string | undefined
    try {
      const head = await this.ctx.http({ url: entry.url, method: 'HEAD' })
      if (head.status >= 400) {
        throw new NotFoundError(`${head.status} for ${entry.url}`, this.instanceId)
      }
      this.seekable = (head.headers['accept-ranges'] ?? '').includes('bytes')
      const length = Number(head.headers['content-length'] ?? '')
      byteLength = Number.isFinite(length) && length > 0 ? length : undefined
      mimeType = head.headers['content-type']
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      // A server that refuses HEAD is common; assume it can still be played
      // and let the player's own error path deal with it if not.
      if (!(error instanceof NetworkError)) throw error
    }

    return {
      kind: 'remote',
      target: entry.url,
      seekable: this.seekable,
      ...(byteLength ? { byteLength } : {}),
      ...(mimeType ? { mimeType } : {}),
    }
  }

  async ping(): Promise<boolean> {
    const first = this.entries.values().next().value
    if (!first) return true
    try {
      const head = await this.ctx.http({ url: first.url, method: 'HEAD', timeoutMs: 5000 })
      return head.status < 400
    } catch {
      return false
    }
  }
}

function lastSegment(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? url)
  } catch {
    return url
  }
}

/** Same derivation as the scanner's, kept local so this package stays alone. */
function hash(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export const name = 'plugin-source-http-url'
export const inject = ['http', 'sources']

/**
 * Register one instance, and return its disposer.
 *
 * The function form of a plugin (docs/03 §1): it provides no service, only
 * behaviour, and unloading it removes exactly what it added.
 *
 * ⚠️ `async` is not decoration. Cordis decides "is this a class?" with
 * `!!func.prototype`, and a plain `function apply(…)` has one — so it would be
 * `new`-ed and the disposer returned here would be discarded, leaving the
 * provider registered forever after unload. An async function has no
 * prototype. `conventions.test.ts` fails the build on the other shape.
 */
export async function apply(ctx: Context, config: SourceHttpUrlConfig = {}) {
  const source = new SourceHttpUrl(ctx, config)
  const off = ctx.sources.register(source.provider())
  return () => off()
}

export default { name, inject, apply }
