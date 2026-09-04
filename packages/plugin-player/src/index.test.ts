/**
 * The transport, against a mock engine.
 *
 * Four of M1's exit criteria are settled here: the six transport controls,
 * headphone-unplug, queue-and-position restore without auto-play, and the
 * prefetch that makes gapless possible. The rest need a device.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import { createMockAudio, type MockAudio } from '@BBeBee/protocol/conformance'
import { NetworkError, NotFoundError, AuthError } from '@BBeBee/protocol'
import type {
  Capabilities,
  DbService,
  MediaProvider,
  StreamHandle,
  Track,
} from '@BBeBee/protocol'
import plugin, { type Player } from './index.js'

const SOURCE = 'local'
const urn = (id: string) => `BBeBee:${SOURCE}:track:${id}`

/** `ctx.audio`, provided by the mock rather than by a real engine. */
function mockAudioPlugin(mock: MockAudio) {
  class MockAudioService extends Service {
    constructor(ctx: Context) {
      super(ctx, 'audio')
    }
  }
  // Cordis services are objects on the context; delegate every member.
  Object.assign(MockAudioService.prototype, mock.service)
  return MockAudioService
}

/** A provider that resolves everything to a local file. */
function localProvider(overrides: Partial<MediaProvider> = {}): MediaProvider {
  const capabilities: Capabilities = {
    search: { tracks: false, albums: false, artists: false, playlists: false, fullText: false },
    browse: false,
    lyrics: false,
    artwork: false,
    library: { read: true, save: false, playlistWrite: false, playlistReorder: false },
    streaming: { qualities: ['lossless'], transcoding: false, seekable: true, urlExpiry: false },
    regional: false,
  }
  return {
    sourceId: SOURCE,
    displayName: 'This device',
    capabilities,
    auth: {
      flow: { kind: 'none' },
      status: { state: 'authenticated' },
      async signIn() {},
      async signOut() {},
      onStatusChange: () => () => {},
    },
    getTrack: async (id) => ({ urn: urn(id), title: id }) as Track,
    resolveStream: async (id): Promise<StreamHandle> => ({
      kind: 'local',
      target: `file:///music/${id}.flac`,
      seekable: true,
    }),
    ping: async () => true,
    ...overrides,
  }
}

interface Harness {
  ctx: Context
  player: Player
  audio: MockAudio
  db: DbService
  root: string
  restart(): Promise<Harness>
}

async function harness(
  opts: { root?: string; provider?: MediaProvider; config?: Record<string, unknown> } = {},
): Promise<Harness> {
  const root = opts.root ?? (await tempDir('bbebee-player'))
  const audio = createMockAudio({ durationMs: 200_000 })

  const ctx = new Context()
  const fibers = [
    await ctx.plugin(PathsNode, { root }),
    await ctx.plugin(FsNode),
    // A file-backed database, so a "restart" is a real restart.
    await ctx.plugin(DbNode, { fileName: 'player-test.db' }),
    await ctx.plugin(mockAudioPlugin(audio)),
    await ctx.plugin(sourcesStub(opts.provider ?? localProvider())),
    await ctx.plugin(plugin, { tickMs: 3_600_000, saveThrottleMs: 0, ...opts.config }),
  ]
  await tick()

  const self: Harness = {
    ctx,
    player: ctx.player as Player,
    audio,
    db: ctx.db,
    root,
    restart: async () => {
      // Teardown in reverse, exactly as the kernel does it, so the player
      // flushes its state before the database closes underneath it.
      for (const fiber of [...fibers].reverse()) await fiber.dispose()
      await tick()
      return harness({ ...opts, root })
    },
  }
  return self
}

/** A minimal `ctx.sources`: the player only needs `forUrn`. */
function sourcesStub(provider: MediaProvider) {
  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    forUrn(u: string) {
      return u.startsWith(`BBeBee:${provider.sourceId}:`) ? provider : undefined
    }
    get providers() {
      return [provider]
    }
    get(id: string) {
      return id === provider.sourceId ? provider : undefined
    }
  }
  return SourcesStub
}

describe('transport', () => {
  it('plays, pauses, and resumes', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a')])

    expect(player.state.status).toBe('playing')
    expect(player.state.trackUrn).toBe(urn('a'))
    expect(audio.playing?.src).toBe('file:///music/a.flac')
    // A source is connected to chainInput, never to the destination.
    expect(audio.sources[0]!.connected).toBe(true)

    audio.advance(5000)
    await player.refresh()
    expect(player.state.positionMs).toBe(5000)

    player.pause()
    expect(player.state.status).toBe('paused')
    audio.advance(5000)
    await player.refresh()
    expect(player.state.positionMs, 'position holds while paused').toBe(5000)

    await player.play()
    expect(player.state.status).toBe('playing')
    audio.advance(1000)
    await player.refresh()
    expect(player.state.positionMs).toBe(6000)
  })

  it('seeks', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a')])
    await player.seek(90_000)
    expect(player.state.positionMs).toBe(90_000)
    expect(audio.playing?.positionMs).toBe(90_000)
  })

  it('advances to the next track and stops at the end of the queue', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a'), urn('b')])

    await player.next()
    expect(player.state.trackUrn).toBe(urn('b'))

    await player.next()
    expect(player.state.status, 'a queue that runs out goes idle').toBe('idle')
    expect(player.queue, 'and the queue itself survives').toHaveLength(2)
    expect(audio.sources.every((s) => !s.playing)).toBe(true)
  })

  it('previous restarts the track past the threshold and steps back before it', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a'), urn('b')])
    await player.next()

    audio.advance(4000)
    await player.refresh()
    await player.previous()
    expect(player.state.trackUrn, 'past 3s, previous restarts').toBe(urn('b'))
    expect(player.state.positionMs).toBe(0)

    await player.previous()
    expect(player.state.trackUrn, 'before 3s, previous goes back').toBe(urn('a'))
  })

  it('ends a track and moves on by itself', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a'), urn('b')])
    audio.finish()
    await tick()
    expect(player.state.trackUrn).toBe(urn('b'))
    expect(player.state.status).toBe('playing')
  })

  it('honours repeat one and repeat all', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a'), urn('b')])

    player.setRepeat('one')
    audio.finish()
    await tick()
    expect(player.state.trackUrn, 'repeat-one replays the same track').toBe(urn('a'))

    player.setRepeat('all')
    await player.next()
    await player.next()
    expect(player.state.trackUrn, 'repeat-all wraps to the start').toBe(urn('a'))
  })

  it('stops without clearing the queue', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b')])
    player.stop()
    expect(player.state.status).toBe('idle')
    expect(player.queue).toHaveLength(2)
  })
})

describe('the queue', () => {
  it('enqueues next and last, in the right places', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('d')])
    player.enqueueNext([urn('b')])
    player.enqueueLast([urn('z')])

    expect(player.queue.map((i) => i.trackUrn)).toEqual([urn('a'), urn('b'), urn('d'), urn('z')])
  })

  it('reorders by writing exactly one row', async () => {
    // The point of a fractional index: dragging a track in a long queue must
    // not renumber the tail (docs/07 §4.6).
    const { player, db } = await harness()
    await player.playNow([urn('a'), urn('b'), urn('c')])
    await tick()

    const before = await db.query<{ id: string; position: string }>(
      'SELECT id, position FROM queue_items ORDER BY position',
    )
    const last = player.queue[2]!
    player.moveItem(last.id, 0)
    await tick()

    const after = await db.query<{ id: string; position: string }>(
      'SELECT id, position FROM queue_items ORDER BY position',
    )
    expect(after.map((r) => r.id)).toEqual([last.id, before[0]!.id, before[1]!.id])

    const changed = after.filter((row) => {
      const match = before.find((b) => b.id === row.id)
      return match?.position !== row.position
    })
    expect(changed.map((c) => c.id), 'only the moved row changes').toEqual([last.id])
  })

  it('removes items, and stops if the playing one goes', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b')])
    const playing = player.queue.find((i) => i.id === player.state.currentItemId)!

    player.removeItems([playing.id])
    expect(player.queue).toHaveLength(1)
    expect(player.state.status).toBe('idle')
  })

  it('shuffles by a persisted seed, so the order survives a restart', async () => {
    // Not a dice roll per advance: a stable permutation is what makes the
    // upcoming queue displayable and `previous()` meaningful (docs/05 §2).
    const first = await harness()
    await first.player.playNow([urn('a'), urn('b'), urn('c'), urn('d'), urn('e')])
    first.player.setShuffle(true)
    await tick()
    const order = first.player.upcoming().map((i) => i.trackUrn)

    const second = await first.restart()
    expect(second.player.state.shuffle).toBe(true)
    expect(second.player.upcoming().map((i) => i.trackUrn)).toEqual(order)
  })
})

describe('persistence', () => {
  it('restores the queue and position across a restart, and does not auto-play', async () => {
    // M1 exit criterion. Resuming into playback on launch is startling,
    // particularly on a phone that just came out of a pocket.
    const first = await harness()
    await first.player.playNow([urn('a'), urn('b')])
    first.audio.advance(42_000)
    await first.player.refresh()
    first.player.pause()
    await tick()

    const second = await first.restart()
    expect(second.player.queue.map((i) => i.trackUrn)).toEqual([urn('a'), urn('b')])
    expect(second.player.state.trackUrn).toBe(urn('a'))
    expect(second.player.state.positionMs).toBe(42_000)
    expect(second.player.state.status, 'must not resume by itself').not.toBe('playing')
    expect(second.audio.loads, 'and must not even load audio').toHaveLength(0)

    // …and pressing play picks up where it left off.
    await second.player.play()
    expect(second.player.state.status).toBe('playing')
    expect(second.audio.playing?.positionMs).toBe(42_000)
  })

  it('survives a corrupted queue row instead of failing to start', async () => {
    // One bad `source_context_json` used to throw inside Player init, leaving
    // the user with no player at all.
    const first = await harness()
    await first.player.playNow([urn('a'), urn('b')])
    await tick()
    await first.db.exec("UPDATE queue_items SET source_context_json = '{oops' WHERE 1 = 1")

    const second = await first.restart()
    expect(second.player.queue).toHaveLength(2)
    expect(second.player.queue[0]!.sourceContext, 'the bad field is dropped').toBeUndefined()
  })

  it('writes a play record and its derived stats together', async () => {
    const { player, audio, db } = await harness()
    await player.playNow([urn('a'), urn('b')])
    audio.advance(120_000)
    await player.refresh()
    audio.finish()
    await tick()

    const history = await db.query<{ track_urn: string; completed: number; ms_played: number }>(
      'SELECT track_urn, completed, ms_played FROM play_history',
    )
    expect(history).toHaveLength(1)
    expect(history[0]!.track_urn).toBe(urn('a'))
    expect(history[0]!.completed).toBe(1)
    expect(history[0]!.ms_played).toBeGreaterThan(0)

    const stats = await db.query<{ urn: string; play_count: number }>(
      'SELECT urn, play_count FROM track_stats',
    )
    expect(stats[0]).toMatchObject({ urn: urn('a'), play_count: 1 })
  })
})

describe('interruptions and routes', () => {
  it('pauses on unplug and never resumes by itself', async () => {
    // M1 exit criterion, and the one audio behaviour users never forgive.
    const { player, audio } = await harness()
    await player.playNow([urn('a')])

    audio.routeChange({ reason: 'device-removed' })
    expect(player.state.status).toBe('paused')

    audio.routeChange({ reason: 'device-added' })
    expect(player.state.status, 'a new device must not start playback').toBe('paused')
  })

  it('pauses for an interruption and resumes only when told to', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a')])

    audio.interrupt({ type: 'began', shouldResume: false })
    expect(player.state.status).toBe('paused')

    audio.interrupt({ type: 'ended', shouldResume: true })
    await tick()
    expect(player.state.status).toBe('playing')
  })

  it('does not resume if the user paused in the meantime', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a')])

    audio.interrupt({ type: 'began', shouldResume: false })
    player.pause() // the user's own pause clears our claim on the resume
    audio.interrupt({ type: 'ended', shouldResume: true })
    await tick()
    expect(player.state.status).toBe('paused')
  })
})

describe('resolution', () => {
  it('asks the before-resolve waterfall, and honours a substitution', async () => {
    // The control arm for M3: with a listener, the player plays a local file
    // and behaves identically. It never learns downloads exist (docs/02 §5).
    const { ctx, player, audio } = await harness()
    ctx.on('player/before-resolve', ((): Promise<StreamHandle> =>
      Promise.resolve({
        kind: 'local',
        target: 'file:///downloads/substituted.flac',
        seekable: true,
      })) as never)

    await player.playNow([urn('a')])
    expect(audio.loads[0]!.src).toBe('file:///downloads/substituted.flac')
    expect(player.state.status).toBe('playing')
  })

  it('buffers local files and streams remote ones', async () => {
    const remote = localProvider({
      resolveStream: async (): Promise<StreamHandle> => ({
        kind: 'remote',
        target: 'https://example.org/a.mp3',
        seekable: true,
      }),
    })
    const { player, audio } = await harness({ provider: remote })
    await player.playNow([urn('a')])
    expect(audio.loads[0]!.opts.strategy).toBe('stream')

    const local = await harness()
    await local.player.playNow([urn('a')])
    expect(local.audio.loads[0]!.opts.strategy).toBe('buffer')
  })
})

describe('errors', () => {
  it('skips a missing track and marks it unavailable', async () => {
    const provider = localProvider({
      resolveStream: async (id: string) => {
        if (id === 'a') throw new NotFoundError('gone', SOURCE)
        return { kind: 'local', target: `file:///music/${id}.flac`, seekable: true } as StreamHandle
      },
    })
    const { player, db } = await harness({ provider })
    await db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES (?, ?, 'p', '{}', 'h', 0, 0)`,
      [SOURCE, `bbebee://local/${SOURCE}`],
    )
    await db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, available, fetched_at)
       VALUES (?, ?, 'a', 'A', 1, 0)`,
      [urn('a'), SOURCE],
    )

    await player.playNow([urn('a'), urn('b')])
    await tick()

    expect(player.state.trackUrn, 'the queue moves on').toBe(urn('b'))
    const row = await db.get<{ available: number }>('SELECT available FROM tracks WHERE urn = ?', [
      urn('a'),
    ])
    expect(row?.available, 'greyed out in lists, not hidden').toBe(0)
  })

  it('retries a network failure, then pauses with the queue intact', async () => {
    let attempts = 0
    const provider = localProvider({
      resolveStream: async () => {
        attempts++
        throw new NetworkError('offline', SOURCE)
      },
    })
    const { player } = await harness({ provider, config: { retryBackoffMs: 1 } })
    await player.playNow([urn('a'), urn('b')])
    await tick()

    expect(attempts, 'three attempts before giving up').toBeGreaterThanOrEqual(3)
    expect(player.state.status).toBe('error')
    expect(player.state.error?.retryable).toBe(true)
    expect(player.queue, 'an error never clears the queue').toHaveLength(2)
  })

  it('stops on an auth error and tells the source', async () => {
    const provider = localProvider({
      resolveStream: async () => {
        throw new AuthError('expired', SOURCE)
      },
    })
    const { ctx, player } = await harness({ provider })
    const expired: string[] = []
    ctx.on('source/auth-expired', (id) => void expired.push(id))

    await player.playNow([urn('a')])
    await tick()

    expect(player.state.status).toBe('error')
    expect(expired, 'the provider gets first refusal').toEqual([SOURCE])
    expect(player.queue).toHaveLength(1)
  })
})

describe('failure loops and races', () => {
  it('gives up after a run of failures instead of skipping forever', async () => {
    // Under repeat-all the queue never runs out, so a queue where every track
    // fails used to skip for ever: an event storm, a write per track, and a UI
    // stuck on "skipping" until the battery went.
    const provider = localProvider({
      resolveStream: async () => {
        throw new NotFoundError('gone', SOURCE)
      },
    })
    const { player, ctx } = await harness({ provider, config: { maxSkipStreak: 4 } })
    let errors = 0
    ctx.on('player/error', () => void errors++)

    // Repeat first: it is the wrap that makes the queue infinite.
    player.setRepeat('all')
    await player.playNow([urn('a'), urn('b'), urn('c')])
    await tick()

    expect(player.state.status).toBe('error')
    expect(errors, 'bounded, not unbounded').toBeLessThanOrEqual(6)
    expect(player.queue, 'and the queue survives').toHaveLength(3)
  })

  it('resets the failure count once a track starts', async () => {
    let attempt = 0
    const provider = localProvider({
      resolveStream: async (id: string) => {
        attempt++
        if (id === 'a') throw new NotFoundError('gone', SOURCE)
        return { kind: 'local', target: `file:///music/${id}.flac`, seekable: true } as StreamHandle
      },
    })
    const { player } = await harness({ provider, config: { maxSkipStreak: 2 } })
    await player.playNow([urn('a'), urn('b')])
    await tick()

    expect(player.state.trackUrn).toBe(urn('b'))
    expect(player.state.status).toBe('playing')
    expect(attempt).toBe(2)
  })

  it('honours a pause that lands while a track is still loading', async () => {
    // Press play, press pause immediately: the load finishes later and used to
    // start playing anyway, because `attach` acted on the flag captured when
    // the load began.
    let release: (() => void) | undefined
    const provider = localProvider({
      resolveStream: async (id: string) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { kind: 'local', target: `file:///music/${id}.flac`, seekable: true } as StreamHandle
      },
    })
    const { player } = await harness({ provider })

    const started = player.playNow([urn('a')])
    await tick()
    player.pause()
    release?.()
    await started
    await tick()

    expect(player.state.status, 'the user asked for paused').toBe('paused')
  })

  it('honours a stop that lands while a track is still loading', async () => {
    let release: (() => void) | undefined
    const provider = localProvider({
      resolveStream: async (id: string) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { kind: 'local', target: `file:///music/${id}.flac`, seekable: true } as StreamHandle
      },
    })
    const { player, audio } = await harness({ provider })

    const started = player.playNow([urn('a')])
    await tick()
    player.stop()
    release?.()
    await started
    await tick()

    expect(player.state.status).toBe('idle')
    expect(audio.playing, 'nothing may be sounding after a stop').toBeUndefined()
  })
})

describe('memory', () => {
  it('streams a local file too large to decode', async () => {
    // Decoded PCM is roughly ten times the file: a two-hour FLAC is ~2.5 GB,
    // and the phone kills the app rather than the track.
    const provider = localProvider({
      resolveStream: async (id: string) =>
        ({
          kind: 'local',
          target: `file:///music/${id}.flac`,
          seekable: true,
          byteLength: 900 * 1024 * 1024,
        }) as StreamHandle,
    })
    const { player, audio } = await harness({ provider })
    await player.playNow([urn('long')])
    expect(audio.loads[0]!.opts.strategy).toBe('stream')
  })

  it('still buffers an ordinary local file', async () => {
    const provider = localProvider({
      resolveStream: async (id: string) =>
        ({
          kind: 'local',
          target: `file:///music/${id}.flac`,
          seekable: true,
          byteLength: 40 * 1024 * 1024,
        }) as StreamHandle,
    })
    const { player, audio } = await harness({ provider })
    await player.playNow([urn('album-track')])
    expect(audio.loads[0]!.opts.strategy).toBe('buffer')
  })
})

describe('prefetch', () => {
  it('decodes the next track before the current one ends', async () => {
    const { player, audio } = await harness()
    audio.setDuration(20_000)
    await player.playNow([urn('a'), urn('b')])

    expect(audio.loads).toHaveLength(1)
    audio.advance(10_000)
    await player.refresh()
    await tick()

    expect(audio.loads, 'the next track is loaded ahead of time').toHaveLength(2)
    expect(audio.loads[1]!.src).toBe('file:///music/b.flac')
    expect(audio.loads[1]!.opts.strategy, 'buffered, so the handoff waits on nothing').toBe('buffer')

    // …and the handoff itself does not load again.
    audio.finish()
    await tick()
    expect(player.state.trackUrn).toBe(urn('b'))
    expect(audio.loads, 'no second load for the track already in hand').toHaveLength(2)
  })

  it('drops the prefetch when the queue changes under it', async () => {
    const { player, audio } = await harness()
    audio.setDuration(20_000)
    await player.playNow([urn('a'), urn('b')])
    audio.advance(10_000)
    await player.refresh()
    await tick()
    expect(audio.loads).toHaveLength(2)

    player.enqueueNext([urn('c')])
    audio.finish()
    await tick()

    expect(player.state.trackUrn, 'the newly queued track plays next').toBe(urn('c'))
    expect(audio.loads[2]!.src).toBe('file:///music/c.flac')
  })

  it('does not prefetch when transitions are off', async () => {
    const { player, audio } = await harness({ config: { transition: 'neither' } })
    audio.setDuration(20_000)
    await player.playNow([urn('a'), urn('b')])
    audio.advance(15_000)
    await player.refresh()
    await tick()
    expect(audio.loads).toHaveLength(1)
  })
})

describe('crossfade', () => {
  it('keeps the outgoing source alive for the length of its fade', async () => {
    // Disposing it at the swap stops it instantly, so the ramp never sounds
    // and a "crossfade" is only ever a fade-in.
    const { ctx, player, audio } = await harness({
      config: { transition: 'crossfade', crossfadeMs: 200 },
    })
    audio.setDuration(20_000)
    const changed: (string | undefined)[] = []
    ctx.on('player/track-changed', (u) => void changed.push(u))
    await player.playNow([urn('a'), urn('b')])
    const outgoing = audio.sources[0]!

    audio.advance(15_000)
    await player.refresh()
    await tick()
    audio.advance(4900)
    await player.refresh()
    await tick()

    expect(player.state.trackUrn, 'the next track has taken over').toBe(urn('b'))
    expect(outgoing.disposed, 'and the old one is still fading, not stopped').toBe(false)
    expect(changed.at(-1), 'a crossfade is a track change like any other').toBe(urn('b'))

    await new Promise((resolve) => setTimeout(resolve, 260))
    expect(outgoing.disposed, 'disposed once the fade is done').toBe(true)
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const root = await tempDir('bbebee-player-leak')
    const audio = createMockAudio()
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(mockAudioPlugin(audio))
    await ctx.plugin(sourcesStub(localProvider()))
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, { tickMs: 3_600_000 })
    await tick()
    await (ctx.player as Player).playNow([urn('a')])
    await fiber.dispose()
    await tick()

    expect(audio.sources.every((s) => s.disposed), 'every source is disposed').toBe(true)
    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
