import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import { NetworkError } from '@BBeBee/protocol'
import type { Capabilities, MediaProvider, SearchResult, Track } from '@BBeBee/protocol'
import plugin, { Sources } from './index.js'

/** A provider with nothing but the required core, declaring no search. */
function fakeProvider(instanceId: string, overrides: Partial<MediaProvider> = {}): MediaProvider {
  const capabilities: Capabilities = {
    search: { tracks: false, albums: false, artists: false, playlists: false, fullText: false },
    browse: false,
    lyrics: false,
    artwork: false,
    library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
    streaming: { qualities: ['normal'], transcoding: false, seekable: true, urlExpiry: false },
    regional: false,
  }
  return {
    instanceId,
    displayName: instanceId,
    capabilities,
    auth: {
      flow: { kind: 'none' },
      status: { state: 'authenticated' },
      async signIn() {},
      async signOut() {},
      onStatusChange: () => () => {},
    },
    getTrack: async (id) => ({ urn: `BBeBee:${instanceId}:track:${id}` }) as Track,
    resolveStream: async () => ({ kind: 'remote', target: 'https://example.org/a.mp3', seekable: true }),
    ping: async () => true,
    ...overrides,
  }
}

/** A provider that searches, answering with `whenSearched`. */
function searchingProvider(
  instanceId: string,
  whenSearched: () => Promise<SearchResult>,
): MediaProvider {
  const base = fakeProvider(instanceId)
  return {
    ...base,
    capabilities: {
      ...base.capabilities,
      search: { tracks: true, albums: false, artists: false, playlists: false, fullText: true },
    },
    search: whenSearched,
  }
}

async function withSources(): Promise<{ ctx: Context; sources: Sources }> {
  const ctx = new Context()
  await ctx.plugin(plugin, {})
  await tick()
  return { ctx, sources: ctx.sources as Sources }
}

describe('plugin-sources', () => {
  it('activates and claims its service', async () => {
    const { ctx } = await withSources()
    expect(ctx.sources).toBeInstanceOf(Sources)
  })

  it('leaves nothing behind when unloaded', async () => {
    // The architecture's central claim, applied to this plugin (docs/09 §6).
    const ctx = new Context()
    await tick()
    const before = snapshotContext(ctx)

    const fiber = await ctx.plugin(plugin, {})
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})

describe('registration', () => {
  it('registers, announces, and unregisters through the disposer', async () => {
    const { ctx, sources } = await withSources()
    const events: string[] = []
    ctx.on('source/registered', (id) => void events.push(`+${id}`))
    ctx.on('source/unregistered', (id) => void events.push(`-${id}`))

    const dispose = sources.register(fakeProvider('local'))
    expect(sources.get('local')?.displayName).toBe('local')
    expect(sources.providers).toHaveLength(1)

    dispose()
    expect(sources.get('local')).toBeUndefined()
    expect(sources.providers).toHaveLength(0)
    expect(events).toEqual(['+local', '-local'])
  })

  it('refuses a duplicate instance id rather than shadowing one', async () => {
    // Two providers on one instance id makes every URN in that namespace
    // ambiguous — the exact thing the URN scheme prevents (docs/07 §1).
    const { sources } = await withSources()
    const first = fakeProvider('navidrome-home')
    sources.register(first)
    const dispose = sources.register(fakeProvider('navidrome-home'))

    expect(sources.providers).toHaveLength(1)
    expect(sources.get('navidrome-home')).toBe(first)

    // The rejected registration's disposer must not remove the incumbent.
    dispose()
    expect(sources.get('navidrome-home')).toBe(first)
  })

  it('resolves a urn to the provider that owns it', async () => {
    const { sources } = await withSources()
    sources.register(fakeProvider('local'))
    sources.register(fakeProvider('navidrome-home'))

    expect(sources.forUrn('BBeBee:local:track:9f2c')?.instanceId).toBe('local')
    expect(sources.forUrn('BBeBee:navidrome-home:album:41af')?.instanceId).toBe('navidrome-home')
    expect(sources.forUrn('BBeBee:jellyfin-nas:track:1')).toBeUndefined()
    expect(sources.forUrn('not-a-urn')).toBeUndefined()
  })
})

describe('searchAll', () => {
  const query = { text: 'bjork' }
  const hit = (title: string): SearchResult => ({
    tracks: { items: [{ title } as Track], hasMore: false },
  })

  it('reports a failing provider instead of dropping it', async () => {
    // The whole point of the per-provider shape: the UI can say
    // "Navidrome: 1 result · Jellyfin: unreachable" (docs/06 §2).
    const { sources } = await withSources()
    sources.register(searchingProvider('navidrome-home', async () => hit('Jóga')))
    sources.register(
      searchingProvider('jellyfin-nas', async () => {
        throw new NetworkError('connection refused', 'jellyfin-nas')
      }),
    )

    const { byProvider } = await sources.searchAll(query)
    expect(byProvider.map((p) => p.instanceId)).toEqual(['navidrome-home', 'jellyfin-nas'])
    expect(byProvider[0]!.result?.tracks?.items[0]?.title).toBe('Jóga')
    expect(byProvider[1]!.error?.code).toBe('network')
    expect(byProvider[1]!.result).toBeUndefined()
  })

  it('maps a raw throw onto the taxonomy rather than letting it escape', async () => {
    const { sources } = await withSources()
    sources.register(
      searchingProvider('rude', async () => {
        throw new Error('kaboom')
      }),
    )

    const { byProvider } = await sources.searchAll(query)
    expect(byProvider[0]!.error?.code).toBe('provider')
    expect(byProvider[0]!.error?.instanceId).toBe('rude')
  })

  it('reports a slow provider as pending without failing the search', async () => {
    const { sources } = await withSources()
    sources.register(searchingProvider('fast', async () => hit('Hyperballad')))
    sources.register(searchingProvider('slow', () => new Promise(() => {})))

    const { byProvider } = await sources.searchAll(query, { timeoutMs: 20 })
    const slow = byProvider.find((p) => p.instanceId === 'slow')!
    expect(slow.pending).toBe(true)
    expect(slow.error).toBeUndefined()
    expect(byProvider.find((p) => p.instanceId === 'fast')!.result).toBeDefined()
  })

  it('skips providers that cannot search, and honours instanceIds', async () => {
    // A provider implementing only the required core must never be called for
    // an optional member — that is what `capabilities` is for (docs/06 §1).
    const { sources } = await withSources()
    let asked = 0
    sources.register(fakeProvider('http-url'))
    sources.register(
      searchingProvider('navidrome-home', async () => {
        asked++
        return hit('Army of Me')
      }),
    )
    sources.register(searchingProvider('jellyfin-nas', async () => hit('Isobel')))

    const all = await sources.searchAll(query)
    expect(all.byProvider.map((p) => p.instanceId)).toEqual(['navidrome-home', 'jellyfin-nas'])

    const one = await sources.searchAll(query, { instanceIds: ['navidrome-home'] })
    expect(one.byProvider.map((p) => p.instanceId)).toEqual(['navidrome-home'])
    expect(asked).toBe(2)
  })

  it('returns an empty fan-out when nothing is registered', async () => {
    const { sources } = await withSources()
    await expect(sources.searchAll(query)).resolves.toEqual({ byProvider: [] })
  })
})
