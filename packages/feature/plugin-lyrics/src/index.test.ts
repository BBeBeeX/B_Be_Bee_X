import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Lyrics, MediaProvider, TransportState } from '@BBeBee/protocol'
import pluginLyrics, { apply, LyricsPlugin, type LyricsConfig } from './index.js'

class PlayerStub extends Service {
  public transport: TransportState = {
    status: 'idle',
    positionMs: 0,
    durationMs: 180_000,
    bufferedMs: 0,
    volume: 1,
    muted: false,
    repeat: 'off',
    shuffle: false,
    playMode: 'sequence',
  }

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  get state() {
    return this.transport
  }

  setTrack(urn: string) {
    this.transport.trackUrn = urn
    this.ctx.emit('player/track-changed', urn)
  }

  setPosition(ms: number) {
    this.transport.positionMs = ms
    this.ctx.emit('player/position', ms, 180000)
  }
}

class SourcesStub extends Service {
  providers: MediaProvider[] = []
  lyricsMap = new Map<string, Lyrics>()
  getLyricsCallCount = 0

  constructor(ctx: Context) {
    super(ctx, 'sources')
  }

  forUrn(_urn: string) {
    return {
      id: 'mock-source',
      name: 'Mock Source',
      capabilities: { lyrics: true } as any,
      getLyrics: async (id: string) => {
        this.getLyricsCallCount++
        if (id === 'error-track') throw new Error('Network timeout')
        return this.lyricsMap.get(id)
      },
    } as unknown as MediaProvider
  }
}

class DbStub extends Service {
  lyricsRows = new Map<string, any>()

  constructor(ctx: Context) {
    super(ctx, 'db')
  }

  async query<T>(sql: string, params: any[]): Promise<T[]> {
    if (sql.includes('FROM lyrics')) {
      const row = this.lyricsRows.get(params[0])
      return row ? [row as T] : []
    }
    return []
  }

  async exec(sql: string, params: any[]): Promise<void> {
    if (sql.includes('INSERT OR REPLACE INTO lyrics')) {
      this.lyricsRows.set(params[0], {
        format: params[2],
        content: params[3],
        synced: params[4],
        offset_ms: params[5],
        language: params[6],
        fetched_at: params[8],
      })
    } else if (sql.includes('DELETE FROM lyrics')) {
      this.lyricsRows.delete(params[0])
    }
  }
}

async function createHarness(config?: LyricsConfig, sharedDbRows?: Map<string, any>) {
  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  await ctx.plugin(SourcesStub)

  class CustomDbStub extends DbStub {
    constructor(c: Context) {
      super(c)
      if (sharedDbRows) {
        this.lyricsRows = sharedDbRows
      }
    }
  }
  await ctx.plugin(CustomDbStub)
  await ctx.plugin(LyricsPlugin, config)

  return {
    ctx,
    player: (ctx as any).player as PlayerStub,
    sources: (ctx as any).sources as SourcesStub,
    db: (ctx as any).db as DbStub,
  }
}

describe('plugin-lyrics', () => {
  it('has valid plugin shape and exports', () => {
    expect(pluginLyrics.name).toBe('plugin-lyrics')
    expect(typeof apply).toBe('function')
  })

  it('initializes in idle state when no song is playing', async () => {
    const { ctx } = await createHarness()
    expect(ctx.lyrics.state.status).toBe('idle')
  })

  it('loads lyrics when player changes track', async () => {
    const { ctx, player, sources } = await createHarness()

    const sampleLrc = `[00:01.00]Hello world\n[00:05.00]Second line`
    sources.lyricsMap.set('s1', {
      format: 'lrc',
      content: sampleLrc,
      synced: true,
    })

    player.setTrack('BBeBee:mock:track:s1')

    // Wait for async fetch
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe(sampleLrc)
  })

  it('transitions to no-lyrics state when source has no lyrics', async () => {
    const { ctx, player } = await createHarness()

    player.setTrack('BBeBee:mock:track:unknown')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('no-lyrics')
    expect(ctx.lyrics.state.lyrics).toBeUndefined()
  })

  it('handles source errors gracefully without crashing', async () => {
    const { ctx, player } = await createHarness()

    player.setTrack('BBeBee:mock:track:error-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('error')
    expect(ctx.lyrics.state.error).toContain('Network timeout')
  })

  it('synchronizes active lyric index upon position updates', async () => {
    const { ctx, player, sources } = await createHarness()

    sources.lyricsMap.set('sync-track', {
      format: 'lrc',
      content: `[00:02.00]Line 1\n[00:06.00]Line 2`,
      synced: true,
    })

    let lastEmittedIdx = -1
    ctx.on('lyrics/active-changed', (idx) => {
      lastEmittedIdx = idx
    })

    player.setTrack('BBeBee:mock:track:sync-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    player.setPosition(1000)
    expect(lastEmittedIdx).toBe(-1)

    player.setPosition(3000)
    expect(lastEmittedIdx).toBe(0)

    player.setPosition(7000)
    expect(lastEmittedIdx).toBe(1)
  })

  it('persists and loads from SQLite database cache', async () => {
    const { player, sources, db } = await createHarness()

    sources.lyricsMap.set('cached-track', {
      format: 'lrc',
      content: `[00:01.00]Cached lyric`,
      synced: true,
    })

    player.setTrack('BBeBee:mock:track:cached-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(db.lyricsRows.has('BBeBee:mock:track:cached-track')).toBe(true)
  })

  it('caches negative lookup in memory to prevent repeated provider queries', async () => {
    const { player, sources, ctx } = await createHarness()

    // 1st play: unknown track without lyrics
    player.setTrack('BBeBee:mock:track:no-lrc-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('no-lyrics')
    expect(sources.getLyricsCallCount).toBe(1)

    // Repeat play / track re-triggered (e.g. single-loop or queue replay)
    player.setTrack('BBeBee:mock:track:no-lrc-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('no-lyrics')
    // Should NOT have made a 2nd call to provider!
    expect(sources.getLyricsCallCount).toBe(1)
  })

  it('persists negative lookup to database with format none and restores it', async () => {
    const { player, sources, db } = await createHarness()

    player.setTrack('BBeBee:mock:track:empty-lrc')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const row = db.lyricsRows.get('BBeBee:mock:track:empty-lrc')
    expect(row).toBeDefined()
    expect(row.format).toBe('none')
    expect(row.content).toBe('')
    expect(sources.getLyricsCallCount).toBe(1)

    // Create a new harness sharing the same db to simulate app restart
    const harness2 = await createHarness(undefined, db.lyricsRows)
    harness2.sources.getLyricsCallCount = 0

    harness2.player.setTrack('BBeBee:mock:track:empty-lrc')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(harness2.ctx.lyrics.state.status).toBe('no-lyrics')
    // Should hit DB negative cache and NOT call provider
    expect(harness2.sources.getLyricsCallCount).toBe(0)
  })

  it('expires negative cache after configured TTL and re-queries', async () => {
    // 40ms negative cache TTL
    const { player, sources } = await createHarness({ negativeCacheTtlMs: 40 })

    player.setTrack('BBeBee:mock:track:expiring-track')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sources.getLyricsCallCount).toBe(1)

    // Query again before TTL -> hits negative cache
    player.setTrack('BBeBee:mock:track:expiring-track')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sources.getLyricsCallCount).toBe(1)

    // Wait until TTL expires (>40ms)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Query again after TTL -> cache expired, queries provider again
    player.setTrack('BBeBee:mock:track:expiring-track')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sources.getLyricsCallCount).toBe(2)
  })

  it('clears negative cache when retry is called', async () => {
    const { player, sources, ctx, db } = await createHarness()

    player.setTrack('BBeBee:mock:track:retry-track')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ctx.lyrics.state.status).toBe('no-lyrics')
    expect(sources.getLyricsCallCount).toBe(1)
    expect(db.lyricsRows.get('BBeBee:mock:track:retry-track')?.format).toBe('none')

    // Now lyrics become available
    sources.lyricsMap.set('retry-track', {
      format: 'lrc',
      content: '[00:01.00]Now available',
      synced: true,
    })

    // Calling retry should clear negative cache and fetch the newly available lyrics
    await ctx.lyrics.retry()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(sources.getLyricsCallCount).toBe(2)
    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:01.00]Now available')
    expect(db.lyricsRows.get('BBeBee:mock:track:retry-track')?.format).toBe('lrc')
  })

  it('queries ctx.lyricSources when audio source lacks lyrics or needs external lyric source', async () => {
    class LyricSourcesStub extends Service {
      lastQuery?: any
      constructor(c: Context) {
        super(c, 'lyricSources')
      }
      async searchLyrics(query: any) {
        this.lastQuery = query
        return {
          format: 'lrc' as const,
          content: '[00:02.00]External Lyric',
          synced: true,
        }
      }
    }

    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(DbStub)
    await ctx.plugin(LyricSourcesStub)
    await ctx.plugin(LyricsPlugin)

    const player = (ctx as any).player as PlayerStub
    const lyricSources = (ctx as any).lyricSources as LyricSourcesStub

    player.transport.trackUrn = 'BBeBee:mock:track:external-needed'
    player.transport.durationMs = 200000
    player.transport.nowPlaying = {
      title: 'External Song',
      artist: 'External Artist',
    }

    player.setTrack('BBeBee:mock:track:external-needed')
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:02.00]External Lyric')
    expect(lyricSources.lastQuery).toBeDefined()
    expect(lyricSources.lastQuery.title).toBe('External Song')
    expect(lyricSources.lastQuery.artist).toBe('External Artist')
  })
})
