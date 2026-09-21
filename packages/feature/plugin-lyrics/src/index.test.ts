import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Lyrics, MediaProvider, TransportState } from '@BBeBee/protocol'
import pluginLyrics, { apply } from './index.js'

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

  constructor(ctx: Context) {
    super(ctx, 'sources')
  }

  forUrn(_urn: string) {
    return {
      id: 'mock-source',
      name: 'Mock Source',
      capabilities: { lyrics: true } as any,
      getLyrics: async (id: string) => {
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
      })
    }
  }
}

async function createHarness() {
  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  await ctx.plugin(SourcesStub)
  await ctx.plugin(DbStub)
  await ctx.plugin(pluginLyrics)

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
})
