/**
 * `ctx.lyrics` — lyric retrieval, caching, synchronization and unified state.
 *
 * Coordinates lyric documents from sources, SQLite cache, and local files,
 * serving both the lyrics panel and the desktop floating lyrics.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  LyricSearchQuery,
  LyricSourcesService,
  Lyrics,
  LyricsService,
  LyricsState,
  TransportState,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { findActiveLyricIndex, parseLrc, type ParsedLyrics } from '@BBeBee/toolkit'

export interface LyricsConfig {
  /** In-memory cache size limit for lyrics documents. */
  cacheSize?: number
  /** Negative cache TTL in ms for tracks without lyrics. Defaults to 24 hours (86_400_000 ms). */
  negativeCacheTtlMs?: number
}

const DEFAULT_CACHE_SIZE = 100
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

export class LyricsPlugin extends Service implements LyricsService {
  static inject = ['player', 'db', 'sources']

  private readonly ownCtx: Context
  private readonly memoryCache = new Map<string, Lyrics>()
  private readonly parsedCache = new Map<string, ParsedLyrics>()
  private readonly negativeCache = new Map<string, number>()
  private readonly cacheSize: number
  private readonly negativeCacheTtlMs: number
  private currentGeneration = 0
  private lastActiveIndex = -1
  private ticker?: ReturnType<typeof setInterval>

  private currentState: LyricsState = {
    status: 'idle',
    offsetMs: 0,
  }
  private lyricSourcesService?: LyricSourcesService

  constructor(ctx: Context, config: LyricsConfig = {}) {
    super(ctx, 'lyrics')
    this.ownCtx = ctx
    this.cacheSize = config.cacheSize ?? DEFAULT_CACHE_SIZE
    this.negativeCacheTtlMs = config.negativeCacheTtlMs ?? DEFAULT_NEGATIVE_CACHE_TTL_MS

    this.ownCtx.inject(['lyricSources'], (scoped: Context) => {
      this.lyricSourcesService = scoped.lyricSources
      return () => {
        this.lyricSourcesService = undefined
      }
    })
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-lyrics: initialized')

    // Contribute the lyrics panel view to the now-playing.panel slot
    this.ownCtx.inject(['ui'], (scoped: Context) =>
      scoped.effect(function* () {
        scoped.logger.debug('lyrics: contributing now-playing.panel slot')
        yield scoped.ui.contribute({
          kind: 'slot',
          id: 'lyrics.panel',
          slot: 'now-playing.panel',
          order: 10,
        })
      }, 'lyrics-ui-contributions'),
    )

    // Handle initial track state if player is already loaded
    const initialUrn = this.ownCtx.player?.state?.trackUrn
    if (initialUrn) {
      void this.handleTrackChanged(initialUrn)
    }

    // Listen to track changes from player
    const offTrackChanged = this.ownCtx.on(
      'player/track-changed',
      (trackUrn: string | undefined) => {
        void this.handleTrackChanged(trackUrn)
      },
    )

    // Listen to player transport state changes (loading, stopped, etc.)
    const offStateChanged = this.ownCtx.on('player/state-changed', (transport: TransportState) => {
      if (transport.status === 'loading' && !this.currentState.trackUrn) {
        this.updateState({ status: 'loading-song' })
      } else if (transport.status === 'idle' && !transport.trackUrn) {
        this.updateState({ status: 'idle', trackUrn: undefined, lyrics: undefined, error: undefined })
      }
    })

    // Listen to 1Hz position ticks from player for synchronization
    const offPosition = this.ownCtx.on('player/position', (positionMs: number) => {
      this.syncActiveIndex(positionMs)
    })

    return () => {
      this.ownCtx.logger.info('plugin-lyrics: disposing')
      if (this.ticker) clearInterval(this.ticker)
      offTrackChanged()
      offStateChanged()
      offPosition()
    }
  }

  get state(): Readonly<LyricsState> {
    return this.currentState
  }

  private updateState(patch: Partial<LyricsState>): void {
    this.currentState = { ...this.currentState, ...patch }
    this.ownCtx.emit('lyrics/changed', this.currentState)
  }

  private async handleTrackChanged(trackUrn: string | undefined): Promise<void> {
    const gen = ++this.currentGeneration
    this.lastActiveIndex = -1
    this.ownCtx.emit('lyrics/active-changed', -1)

    if (!trackUrn) {
      this.updateState({
        status: 'idle',
        trackUrn: undefined,
        lyrics: undefined,
        error: undefined,
        offsetMs: 0,
      })
      return
    }

    this.updateState({
      status: 'loading-lyrics',
      trackUrn,
      lyrics: undefined,
      error: undefined,
      offsetMs: 0,
    })

    await this.fetchAndApplyLyrics(trackUrn, gen)
  }

  private async fetchAndApplyLyrics(trackUrn: string, gen: number): Promise<void> {
    try {
      const lyrics = await this.getLyricsForTrack(trackUrn)

      // Guard against race conditions if track has changed while fetching
      if (gen !== this.currentGeneration) return

      if (!lyrics || !lyrics.content.trim()) {
        this.updateState({
          status: 'no-lyrics',
          trackUrn,
          lyrics: undefined,
          error: undefined,
        })
        return
      }

      this.updateState({
        status: 'ready',
        trackUrn,
        lyrics,
        error: undefined,
        offsetMs: lyrics.offsetMs ?? 0,
      })
    } catch (err) {
      if (gen !== this.currentGeneration) return

      const message = err instanceof Error ? err.message : String(err)
      this.ownCtx.logger.warn(`lyrics: failed to fetch lyrics for ${trackUrn}: ${message}`)
      this.updateState({
        status: 'error',
        trackUrn,
        lyrics: undefined,
        error: message,
      })
    }
  }

  async getLyricsForTrack(trackUrn: string): Promise<Lyrics | undefined> {
    // 1. In-memory positive cache
    if (this.memoryCache.has(trackUrn)) {
      return this.memoryCache.get(trackUrn)
    }

    // 1.5. In-memory negative cache (empty lyrics within TTL)
    const negExpiresAt = this.negativeCache.get(trackUrn)
    if (negExpiresAt !== undefined) {
      if (Date.now() < negExpiresAt) {
        return undefined
      }
      this.negativeCache.delete(trackUrn)
    }

    // 2. Persistent SQLite cache
    if (this.ownCtx.db) {
      try {
        const rows = await this.ownCtx.db.query<{
          format: string
          content: string
          synced: number
          offset_ms: number
          language: string
          fetched_at?: number
        }>(
          'SELECT format, content, synced, offset_ms, language, fetched_at FROM lyrics WHERE track_urn = ? ORDER BY is_preferred DESC, fetched_at DESC LIMIT 1',
          [trackUrn],
        )
        if (rows.length > 0 && rows[0]) {
          const row = rows[0]
          // Check for negative cache marker in DB
          if (row.format === 'none' || !row.content) {
            const age = Date.now() - (row.fetched_at ?? 0)
            if (age < this.negativeCacheTtlMs) {
              this.rememberNegative(trackUrn, (row.fetched_at ?? Date.now()) + this.negativeCacheTtlMs)
              return undefined
            } else {
              // Expired negative cache in DB — prune and fall through to re-fetch
              void this.ownCtx.db
                .exec('DELETE FROM lyrics WHERE track_urn = ? AND format = ?', [trackUrn, 'none'])
                .catch(() => undefined)
            }
          } else {
            const lyrics: Lyrics = {
              format: row.format as Lyrics['format'],
              content: row.content,
              synced: row.synced === 1,
              offsetMs: row.offset_ms,
              language: row.language || undefined,
            }
            this.remember(trackUrn, lyrics)
            return lyrics
          }
        }
      } catch (e) {
        this.ownCtx.logger.debug(`lyrics: db lookup failed for ${trackUrn}: ${String(e)}`)
      }
    }

    // 3. Online media provider resolution & third-party lyric sources
    const parsedUrn = tryParseUrn(trackUrn)
    const sourceRecord =
      parsedUrn && this.ownCtx.sources?.source ? this.ownCtx.sources.source(parsedUrn.sourceId) : undefined
    const needsLyricSource = sourceRecord?.needsLyricSource ?? false

    // Priority 1: If audio source explicitly requested external lyric source, query lyricSources first
    if (needsLyricSource && this.lyricSourcesService) {
      const query = await this.resolveTrackQuery(trackUrn)
      const fetched = await this.lyricSourcesService.searchLyrics(query)
      if (fetched && fetched.content) {
        this.remember(trackUrn, fetched)
        await this.persistLyrics(trackUrn, fetched)
        return fetched
      }
    }

    // Priority 2: Online media provider from audio source
    if (this.ownCtx.sources && parsedUrn) {
      const provider = this.ownCtx.sources.forUrn(trackUrn)
      if (provider?.getLyrics) {
        const fetched = await provider.getLyrics(parsedUrn.id)
        if (fetched && fetched.content) {
          this.remember(trackUrn, fetched)
          await this.persistLyrics(trackUrn, fetched)
          return fetched
        }
      }
    }

    // Priority 3: Fallback to external lyric sources if audio source lacked lyrics
    if (!needsLyricSource && this.lyricSourcesService) {
      const query = await this.resolveTrackQuery(trackUrn)
      const fetched = await this.lyricSourcesService.searchLyrics(query)
      if (fetched && fetched.content) {
        this.remember(trackUrn, fetched)
        await this.persistLyrics(trackUrn, fetched)
        return fetched
      }
    }

    // Online provider returned nothing (or has no lyrics).
    // Store in negative cache for 1 day to prevent repeated network requests on loop/replay.
    this.rememberNegative(trackUrn, Date.now() + this.negativeCacheTtlMs)
    await this.persistNegativeCache(trackUrn)

    return undefined
  }

  private async resolveTrackQuery(trackUrn: string): Promise<LyricSearchQuery> {
    let title: string | undefined
    let artist: string | undefined
    let duration = 0

    const playerState = this.ownCtx.player?.state
    if (playerState?.trackUrn === trackUrn && playerState.nowPlaying) {
      title = playerState.nowPlaying.title
      artist = playerState.nowPlaying.artist ?? ''
      duration = playerState.durationMs ?? 0
    } else if (this.ownCtx.sources) {
      try {
        const tracks = await this.ownCtx.sources.getTracks([trackUrn])
        if (tracks[0]) {
          title = tracks[0].title
          artist = tracks[0].artists?.map((a) => a.name).join(', ') ?? ''
          duration = tracks[0].durationMs ?? 0
        }
      } catch {
        // ignore
      }
    }

    if (!title) {
      const parsed = tryParseUrn(trackUrn)
      title = parsed?.id ?? trackUrn
    }

    return {
      title,
      artist: artist ?? '',
      duration,
    }
  }

  private remember(urn: string, lyrics: Lyrics): void {
    this.negativeCache.delete(urn)
    if (this.memoryCache.size >= this.cacheSize) {
      const oldestKey = this.memoryCache.keys().next().value
      if (oldestKey) {
        this.memoryCache.delete(oldestKey)
        this.parsedCache.delete(oldestKey)
      }
    }
    this.memoryCache.set(urn, lyrics)
  }

  private rememberNegative(urn: string, expiresAt: number): void {
    if (this.negativeCache.size >= this.cacheSize) {
      const oldestKey = this.negativeCache.keys().next().value
      if (oldestKey) {
        this.negativeCache.delete(oldestKey)
      }
    }
    this.negativeCache.set(urn, expiresAt)
  }

  private async persistLyrics(trackUrn: string, lyrics: Lyrics): Promise<void> {
    if (!this.ownCtx.db) return
    try {
      const parsedUrn = tryParseUrn(trackUrn)
      const sourceId = parsedUrn?.sourceId ?? 'default'
      await this.ownCtx.db.exec(
        `INSERT OR REPLACE INTO lyrics (track_urn, source_id, format, content, synced, offset_ms, language, is_preferred, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trackUrn,
          sourceId,
          lyrics.format,
          lyrics.content,
          lyrics.synced ? 1 : 0,
          lyrics.offsetMs ?? 0,
          lyrics.language ?? '',
          1,
          Date.now(),
        ],
      )
    } catch (e) {
      this.ownCtx.logger.debug(`lyrics: db persist failed for ${trackUrn}: ${String(e)}`)
    }
  }

  private async persistNegativeCache(trackUrn: string): Promise<void> {
    if (!this.ownCtx.db) return
    try {
      const parsedUrn = tryParseUrn(trackUrn)
      const sourceId = parsedUrn?.sourceId ?? 'default'
      await this.ownCtx.db.exec(
        `INSERT OR REPLACE INTO lyrics (track_urn, source_id, format, content, synced, offset_ms, language, is_preferred, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trackUrn,
          sourceId,
          'none',
          '',
          0,
          0,
          '',
          0,
          Date.now(),
        ],
      )
    } catch (e) {
      this.ownCtx.logger.debug(`lyrics: db negative cache persist failed for ${trackUrn}: ${String(e)}`)
    }
  }

  setOffset(offsetMs: number): void {
    this.updateState({ offsetMs })
    const trackUrn = this.currentState.trackUrn
    if (trackUrn) {
      const cached = this.memoryCache.get(trackUrn)
      if (cached) {
        cached.offsetMs = offsetMs
      }
      if (this.ownCtx.db) {
        void this.ownCtx.db
          .exec('UPDATE lyrics SET offset_ms = ? WHERE track_urn = ?', [offsetMs, trackUrn])
          .catch(() => undefined)
      }
    }
  }

  async clearCache(trackUrn?: string): Promise<void> {
    if (trackUrn) {
      this.memoryCache.delete(trackUrn)
      this.parsedCache.delete(trackUrn)
      this.negativeCache.delete(trackUrn)
      if (this.ownCtx.db) {
        try {
          await this.ownCtx.db.exec('DELETE FROM lyrics WHERE track_urn = ?', [trackUrn])
        } catch (e) {
          this.ownCtx.logger.debug(`lyrics: failed to clear cache for ${trackUrn}: ${String(e)}`)
        }
      }
    } else {
      this.memoryCache.clear()
      this.parsedCache.clear()
      this.negativeCache.clear()
      if (this.ownCtx.db) {
        try {
          await this.ownCtx.db.exec('DELETE FROM lyrics')
        } catch (e) {
          this.ownCtx.logger.debug(`lyrics: failed to clear all lyrics cache: ${String(e)}`)
        }
      }
    }
  }

  async retry(): Promise<void> {
    const urn = this.currentState.trackUrn
    if (urn) {
      this.memoryCache.delete(urn)
      this.parsedCache.delete(urn)
      this.negativeCache.delete(urn)
      if (this.ownCtx.db) {
        await this.ownCtx.db
          .exec('DELETE FROM lyrics WHERE track_urn = ? AND format = ?', [urn, 'none'])
          .catch(() => undefined)
      }
      await this.handleTrackChanged(urn)
    }
  }

  private syncActiveIndex(positionMs: number): void {
    if (this.currentState.status !== 'ready' || !this.currentState.lyrics) {
      if (this.lastActiveIndex !== -1) {
        this.lastActiveIndex = -1
        this.ownCtx.emit('lyrics/active-changed', -1)
      }
      return
    }

    const urn = this.currentState.trackUrn ?? ''
    let parsed = this.parsedCache.get(urn)
    if (!parsed) {
      parsed = parseLrc(this.currentState.lyrics.content, { offsetMs: this.currentState.offsetMs })
      this.parsedCache.set(urn, parsed)
    }

    if (!parsed.synced || parsed.lines.length === 0) {
      if (this.lastActiveIndex !== -1) {
        this.lastActiveIndex = -1
        this.ownCtx.emit('lyrics/active-changed', -1)
      }
      return
    }

    const nextIndex = findActiveLyricIndex(parsed.lines, positionMs, this.currentState.offsetMs)
    if (nextIndex !== this.lastActiveIndex) {
      this.lastActiveIndex = nextIndex
      this.ownCtx.emit('lyrics/active-changed', nextIndex)
    }
  }
}

export const name = 'plugin-lyrics'

export async function apply(ctx: Context, config?: LyricsConfig) {
  ctx.logger.info('plugin-lyrics: loaded')
  const fiber = await ctx.plugin(LyricsPlugin, config)
  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
