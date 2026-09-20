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
}

const DEFAULT_CACHE_SIZE = 100

export class LyricsPlugin extends Service implements LyricsService {
  static inject = ['player', 'db', 'sources']

  private readonly ownCtx: Context
  private readonly memoryCache = new Map<string, Lyrics>()
  private readonly parsedCache = new Map<string, ParsedLyrics>()
  private currentGeneration = 0
  private lastActiveIndex = -1
  private ticker?: ReturnType<typeof setInterval>

  private currentState: LyricsState = {
    status: 'idle',
    offsetMs: 0,
  }

  constructor(ctx: Context, _config: LyricsConfig = {}) {
    super(ctx, 'lyrics')
    this.ownCtx = ctx
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
    // 1. In-memory cache
    if (this.memoryCache.has(trackUrn)) {
      return this.memoryCache.get(trackUrn)
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
        }>('SELECT format, content, synced, offset_ms, language FROM lyrics WHERE track_urn = ? LIMIT 1', [
          trackUrn,
        ])
        if (rows.length > 0 && rows[0]) {
          const row = rows[0]
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
      } catch (e) {
        this.ownCtx.logger.debug(`lyrics: db lookup failed for ${trackUrn}: ${String(e)}`)
      }
    }

    // 3. Online media provider resolution via ctx.sources
    if (this.ownCtx.sources) {
      const parsedUrn = tryParseUrn(trackUrn)
      if (parsedUrn) {
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
    }

    return undefined
  }

  private remember(urn: string, lyrics: Lyrics): void {
    if (this.memoryCache.size >= DEFAULT_CACHE_SIZE) {
      const oldestKey = this.memoryCache.keys().next().value
      if (oldestKey) {
        this.memoryCache.delete(oldestKey)
        this.parsedCache.delete(oldestKey)
      }
    }
    this.memoryCache.set(urn, lyrics)
  }

  private async persistLyrics(trackUrn: string, lyrics: Lyrics): Promise<void> {
    if (!this.ownCtx.db) return
    try {
      const parsedUrn = tryParseUrn(trackUrn)
      const instanceId = parsedUrn?.sourceId ?? 'default'
      await this.ownCtx.db.exec(
        `INSERT OR REPLACE INTO lyrics (track_urn, instance_id, format, content, synced, offset_ms, language, is_preferred, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trackUrn,
          instanceId,
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

  setOffset(offsetMs: number): void {
    this.updateState({ offsetMs })
  }

  async retry(): Promise<void> {
    const urn = this.currentState.trackUrn
    if (urn) {
      this.memoryCache.delete(urn)
      this.parsedCache.delete(urn)
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

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-lyrics: loaded')
  const fiber = await ctx.plugin(LyricsPlugin)
  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
