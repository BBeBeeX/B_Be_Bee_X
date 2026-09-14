/**
 * `plugin-download` — play a remote track once, keep a local copy, and prefer
 * that copy from then on.
 *
 * The mechanism is the one docs/05 §2 draws and docs/07 §4.5 names: a cached
 * stream is a **`media_bindings` row** (`origin: 'download'`), and the player
 * learns about it through the `player/before-resolve` waterfall. A hit answers
 * with `kind: 'local'` and the audio engine opens a file instead of a socket;
 * a miss calls the rest of the chain (failover, then the provider) and caches
 * whatever comes back **while the user listens**.
 *
 * Three properties are the design:
 *
 *  - **The player never learns this exists.** It already knows how to play a
 *    local file — that is how the scanner's tracks work — so disabling this
 *    plugin leaves playback streaming exactly as before, and no branch
 *    anywhere says "is this cached?" (docs/06 §12).
 *  - **A binding whose file is gone is deleted, not left to fail.** Files
 *    disappear: an OS evicts a cache, a user cleans up, a sync tool removes a
 *    folder. The lookup verifies presence and drops the row it cannot honour.
 *  - **The cache is bounded.** Cached files are evicted oldest-first once the
 *    configured budget is exceeded, so "cache every playback" cannot fill a
 *    disk. The row is what records the size; the file follows the row.
 *
 * What this deliberately does *not* do yet, and M3 will add: a resumable
 * task queue (a kill mid-write costs the partial file and nothing else),
 * explicit user-initiated downloads, `wifi_only`/`charging_only` policies and
 * a download UI (docs/10 §M3).
 */

import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { StreamHandle, StreamPrefs, StreamQuality, Uri } from '@BBeBee/protocol'
import { stableId } from '@BBeBee/toolkit'

export interface DownloadConfig {
  /**
   * Cache remote streams at all.
   *
   * `false` stops new writes but still answers from bindings that already
   * exist: "stop downloading" is not "forget what I have".
   */
  enabled?: boolean
  /**
   * How many bytes cached media may occupy before the least recently played
   * entries are evicted. `0` disables eviction entirely.
   */
  maxCacheBytes?: number
}

const DEFAULTS: Required<DownloadConfig> = {
  enabled: true,
  // ~1 GiB: enough for a long offline session, small enough to be a cache
  // rather than a library.
  maxCacheBytes: 1024 * 1024 * 1024,
}

/**
 * How long after serving a file a `player/error` still counts as "this cache
 * entry is broken". A decode failure arrives in seconds; an unrelated error
 * arriving minutes later is not about the file.
 */
const INVALIDATION_WINDOW_MS = 120_000

/** The columns this plugin reads back out of `media_bindings`. */
interface BindingRow {
  id: string
  uri: Uri
  format: string | null
  bitrate_kbps: number | null
  sample_rate: number | null
  size_bytes: number | null
  quality: string | null
}

/** What `evict` needs about a row, and no more. */
interface EvictionRow {
  id: string
  uri: Uri
  size_bytes: number | null
}

export class PlaybackCache {
  private readonly config: Required<DownloadConfig>
  /**
   * One download per track URN.
   *
   * A track can be resolved twice in quick succession — the player's prefetch
   * resolves the next item while the current one is still sounding, and a
   * failed load retries — and two writers on one path would race each other
   * into a truncated file.
   */
  private readonly inFlight = new Map<string, AbortController>()
  /**
   * The last track this cache served from a file.
   *
   * A cached play that then fails is a cache problem, not a network one:
   * dropping the binding means the next attempt streams and re-caches. Without
   * this a corrupt file is a track that can never play again.
   */
  private lastServed?: { urn: string; at: number }
  private disposed = false

  constructor(
    private readonly ctx: Context,
    config: DownloadConfig = {},
  ) {
    // Explicit rather than spread: `enabled: false` and `maxCacheBytes: 0` are
    // real values, and a spread of a partial config preserves them — this
    // shape just makes the defaults obvious.
    this.config = {
      enabled: config.enabled ?? DEFAULTS.enabled,
      maxCacheBytes: config.maxCacheBytes ?? DEFAULTS.maxCacheBytes,
    }
  }

  /**
   * Create the cache directory up front, and reconcile it.
   *
   * Not fatal if it fails: existing bindings still play, and caching simply
   * has nowhere to land — which the per-download error path then reports.
   */
  async prepare(): Promise<void> {
    try {
      await this.ctx.fs.mkdir(this.directory(), { recursive: true })
      await this.sweep()
    } catch (error) {
      this.ctx.logger.warn(`download: could not prepare the cache directory: ${String(error)}`)
    }
  }

  /**
   * Delete files no binding names.
   *
   * A binding is what "this file is a track's cached audio" means, and it can
   * disappear without this plugin being told: removing a source cascades its
   * tracks and their bindings away in SQL, and the files stay. Without this
   * sweep those bytes are invisible to eviction — it walks rows — and a
   * removed source leaves its library in the cache for ever.
   */
  private async sweep(): Promise<void> {
    const directory = this.directory()
    const files = await this.ctx.fs.list(directory)
    if (files.length === 0) return

    const rows = await this.ctx.db.query<{ uri: Uri }>(
      `SELECT uri FROM media_bindings WHERE origin = 'download'`,
    )
    const named = new Set(rows.map((row) => this.ctx.fs.basename(row.uri)))
    for (const file of files) {
      if (file.isDirectory || named.has(file.name)) continue
      this.ctx.logger.info(`download: removing an orphaned cache file (${file.name})`)
      await this.ctx.fs.remove(file.uri).catch(() => undefined)
    }
  }

  /**
   * The `player/before-resolve` listener.
   *
   * A hit short-circuits: the waterfall's whole purpose is that the player
   * accepts either answer without knowing which one it got.
   */
  async resolve(
    urn: string,
    _prefs: StreamPrefs,
    next: () => Promise<StreamHandle>,
  ): Promise<StreamHandle> {
    const cached = await this.cachedHandle(urn)
    if (cached) return cached

    const handle = await next()
    // Only a remote resolution is worth caching: `kind: 'local'` already is a
    // file, whether the scanner put it there or a previous cache did.
    if (this.config.enabled && handle.kind === 'remote') this.schedule(urn, handle)
    return handle
  }

  /**
   * Drop a binding this cache served, after the player failed to play it.
   *
   * Only the most recently served track is considered, and only for a short
   * window: a `player/error` for an unrelated track — or the same track hours
   * later, streaming again — must not evict a good file.
   */
  invalidateServed(urn: string): void {
    const served = this.lastServed
    if (!served || served.urn !== urn) return
    if (Date.now() - served.at > INVALIDATION_WINDOW_MS) return
    this.lastServed = undefined
    this.ctx.logger.warn(`download: cached copy of ${urn} failed to play; dropping it`)
    void this.forget(urn).catch((error: unknown) => {
      this.ctx.logger.warn(`download: could not drop ${urn}: ${String(error)}`)
    })
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.inFlight.values()) controller.abort()
    this.inFlight.clear()
  }

  /* ── reading the cache ─────────────────────────────────────────────── */

  /** The local file for `urn`, or nothing when there is no usable binding. */
  async cachedHandle(urn: string): Promise<StreamHandle | undefined> {
    let row: BindingRow | undefined
    try {
      row = await this.ctx.db.get<BindingRow>(
        `SELECT id, uri, format, bitrate_kbps, sample_rate, size_bytes, quality
           FROM media_bindings
          WHERE track_urn = ? AND origin = 'download'
          ORDER BY verified_at DESC, created_at DESC
          LIMIT 1`,
        [urn],
      )
    } catch (error) {
      // A cache read that fails must not take playback down with it: the
      // caller still gets the remote stream, which is the pre-cache status quo.
      this.ctx.logger.warn(`download: could not read the cache for ${urn}: ${String(error)}`)
      return undefined
    }
    if (!row) return undefined

    if (!(await this.ctx.fs.exists(row.uri).catch(() => false))) {
      // docs/07 §4.5: a binding whose file is missing is deleted rather than
      // left to fail at play time.
      await this.ctx.db
        .exec('DELETE FROM media_bindings WHERE id = ?', [row.id])
        .catch((error: unknown) => {
          this.ctx.logger.warn(`download: could not drop a stale binding: ${String(error)}`)
        })
      return undefined
    }

    // The clock LRU eviction reads. A play is the strongest "still wanted".
    await this.ctx.db
      .exec('UPDATE media_bindings SET verified_at = ? WHERE id = ?', [Date.now(), row.id])
      .catch(() => undefined)

    this.lastServed = { urn, at: Date.now() }
    return {
      kind: 'local',
      target: await this.ctx.fs.toPlayableUri(row.uri),
      seekable: true,
      ...(row.format ? { codec: row.format } : {}),
      ...(row.bitrate_kbps ? { bitrateKbps: row.bitrate_kbps } : {}),
      ...(row.sample_rate ? { sampleRate: row.sample_rate } : {}),
      ...(row.size_bytes ? { byteLength: row.size_bytes } : {}),
      ...(row.quality ? { quality: row.quality as StreamQuality } : {}),
    }
  }

  /* ── writing the cache ─────────────────────────────────────────────── */

  private schedule(urn: string, handle: StreamHandle): void {
    if (this.disposed || this.inFlight.has(urn)) return
    const controller = new AbortController()
    this.inFlight.set(urn, controller)
    void this.cacheOne(urn, handle, controller)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        this.ctx.logger.warn(`download: could not cache ${urn}: ${String(error)}`)
      })
      .finally(() => {
        if (this.inFlight.get(urn) === controller) this.inFlight.delete(urn)
      })
  }

  private async cacheOne(
    urn: string,
    handle: StreamHandle,
    controller: AbortController,
  ): Promise<void> {
    const directory = this.directory()
    await this.ctx.fs.mkdir(directory, { recursive: true })

    const format = formatFor(handle)
    const id = bindingId(urn)
    // ⚠️ The resolved URL is signed and the headers carry the source's referer
    // and user agent. Neither is logged, here or on failure: a stream URL is
    // a credential for as long as it lives (docs/06 §5, docs/03 §7).
    const target = this.ctx.fs.join(directory, `${id}${format ? `.${format}` : ''}`)
    const started = Date.now()

    const { bytes } = await this.ctx.http.download({
      url: handle.target,
      ...(handle.headers ? { headers: handle.headers } : {}),
      to: target,
      signal: controller.signal,
    })
    if (controller.signal.aborted) return
    if (bytes <= 0) throw new Error('the server returned no bytes')

    const stale = await this.ctx.db.query<{ uri: Uri }>(
      `SELECT uri FROM media_bindings WHERE track_urn = ? AND origin = 'download'`,
      [urn],
    )

    await this.ctx.db.transaction(async (tx) => {
      await tx.exec(`DELETE FROM media_bindings WHERE track_urn = ? AND origin = 'download'`, [urn])
      await tx.exec(
        `INSERT INTO media_bindings (id, track_urn, uri, format, bitrate_kbps, sample_rate,
                                     size_bytes, origin, quality, verified_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'download', ?, ?, ?)`,
        [
          id,
          urn,
          target,
          format ?? null,
          handle.bitrateKbps ?? null,
          handle.sampleRate ?? null,
          bytes,
          handle.quality ?? null,
          Date.now(),
          started,
        ],
      )
    })

    // Files first, rows first, doesn't matter much — but a stale row replaced
    // by a row pointing at a new path leaves the old bytes behind unless they
    // are removed explicitly.
    for (const row of stale) {
      if (row.uri !== target) await this.ctx.fs.remove(row.uri).catch(() => undefined)
    }

    this.ctx.logger.info(
      `download: cached ${urn} (${bytes} byte(s)${format ? ` as ${format}` : ''})`,
    )
    await this.evict()
  }

  /**
   * Keep the cache inside its budget, oldest first.
   *
   * Ordered by `verified_at`, which `cachedHandle` refreshes on every play, so
   * this is least-recently-*played* rather than least-recently-downloaded —
   * the file a user keeps returning to is the last one to go.
   */
  private async evict(): Promise<void> {
    const budget = this.config.maxCacheBytes
    if (budget <= 0) return

    const rows = await this.ctx.db.query<EvictionRow>(
      `SELECT id, uri, size_bytes FROM media_bindings
        WHERE origin = 'download'
        ORDER BY COALESCE(verified_at, created_at) ASC`,
    )
    let total = rows.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0)

    for (const row of rows) {
      if (total <= budget) return
      await this.ctx.fs.remove(row.uri).catch(() => undefined)
      await this.ctx.db.exec('DELETE FROM media_bindings WHERE id = ?', [row.id]).catch(() => undefined)
      total -= row.size_bytes ?? 0
      this.ctx.logger.info(`download: evicted ${row.id} to stay within the cache budget`)
    }
  }

  private async forget(urn: string): Promise<void> {
    const rows = await this.ctx.db.query<EvictionRow>(
      `SELECT id, uri, size_bytes FROM media_bindings WHERE track_urn = ? AND origin = 'download'`,
      [urn],
    )
    for (const row of rows) {
      await this.ctx.fs.remove(row.uri).catch(() => undefined)
      await this.ctx.db.exec('DELETE FROM media_bindings WHERE id = ?', [row.id]).catch(() => undefined)
    }
  }

  /**
   * Where cached media lands.
   *
   * `ctx.paths.cache` and not `downloads`: this is evictable by design, and
   * the OS is free to reclaim the cache directory. An explicit download — the
   * one a user asks for and expects to keep — belongs in `downloads`, and
   * that is M3's.
   */
  private directory(): Uri {
    return this.ctx.fs.join(this.ctx.paths.cache, 'media')
  }
}

/** One binding id per track, stable across restarts. */
function bindingId(urn: string): string {
  return `bd_${stableId('download', urn)}`
}

/** Container formats this app can name, and the spellings a source may use. */
const MIME_FORMATS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
}

const URL_FORMATS = new Set([
  'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'webm', 'm4s', 'mp4',
])

/**
 * The file extension a stream should be cached under, where one can be told.
 *
 * The extension matters only for files too large to decode in memory: those
 * are opened by a media element, which sniffs content but prefers a name it
 * recognises. `undefined` is an honest answer for a source that names no codec
 * and serves a URL with no extension — the file gets no suffix and the buffer
 * path (the common case) decodes it anyway.
 */
export function formatFor(handle: StreamHandle): string | undefined {
  const codec = handle.codec?.toLowerCase() ?? ''
  if (codec.includes('flac')) return 'flac'
  if (codec.includes('mp4a') || codec.includes('aac')) return 'm4a'
  if (codec.includes('mpeg')) return 'mp3'
  if (codec.includes('opus')) return 'opus'
  if (codec.includes('vorbis')) return 'ogg'
  if (codec.includes('wav')) return 'wav'

  const byMime = handle.mimeType ? MIME_FORMATS[handle.mimeType.toLowerCase()] : undefined
  if (byMime) return byMime

  const path = handle.target.split('?')[0]?.split('#')[0] ?? ''
  const dot = path.lastIndexOf('.')
  const extension = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  // An fMP4 segment is the audio of an MP4; `.m4s` is not a name a decoder
  // recognises on its own.
  if (extension === 'm4s' || extension === 'mp4') return 'm4a'
  return URL_FORMATS.has(extension) ? extension : undefined
}

export const name = 'plugin-download'

/**
 * All required, not optional: a build without a database or a filesystem has
 * nowhere to keep a binding and nowhere to put the bytes, and a plugin that
 * started anyway would report every play as a cache miss while downloading
 * into nothing. All four are bootstrap services in both shells.
 */
export const inject = ['fs', 'db', 'paths', 'http']

export async function apply(ctx: Context, config: DownloadConfig = {}) {
  ctx.logger.info('plugin-download: loaded')
  const cache = new PlaybackCache(ctx, config)
  await cache.prepare()

  // Prepended: a cache hit is a local file read, and there is no reason to run
  // a network-oriented listener (failover, a future re-auth) before it.
  const offResolve = ctx.on(
    'player/before-resolve',
    (urn: string, prefs: StreamPrefs, next: () => Promise<StreamHandle>) =>
      cache.resolve(urn, prefs, next),
    { prepend: true },
  )
  const offError = ctx.on('player/error', (_error, urn: string) => cache.invalidateServed(urn))

  return () => {
    offResolve()
    offError()
    cache.dispose()
  }
}

export default { name, inject, apply }
