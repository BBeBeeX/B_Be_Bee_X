// @vitest-environment jsdom
/**
 * The menu models, without a renderer where possible.
 *
 * The kits render `MenuItemSpec`s; what is pinned here is which actions an
 * entity gets, what each one calls, and — the part users notice — that an
 * action a build cannot perform is *absent* rather than present and throwing.
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { LibraryService, Playlist, Track } from '@BBeBee/protocol'
import {
  addToPlaylistSubmenu,
  collectionMenuItems,
  playlistMenuItems,
  trackMenuItems,
  useTrackMenu,
} from './index.js'

afterEach(cleanup)

const URN = 'BBeBee:local:track:1'
const ALBUM = 'BBeBee:local:album:1'

const track: Track = {
  urn: URN,
  title: 'Jóga',
  artists: [],
  albumUrn: ALBUM,
  loved: true,
}

const playlists: Playlist[] = [
  { urn: 'BBeBee:local:playlist:1', name: 'Road trip' },
  { urn: 'BBeBee:local:playlist:smart', name: 'Loved', isSmart: true },
]

class LibraryStub extends Service {
  readonly calls: string[] = []
  items: readonly Playlist[] = playlists
  constructor(ctx: Context) {
    super(ctx, 'library')
  }
  async listPlaylists() {
    return { items: this.items, hasMore: false }
  }
  async createPlaylist(name: string) {
    this.calls.push(`create:${name}`)
    return { urn: 'BBeBee:local:playlist:new', name }
  }
  async addTracks(urn: string, urns: readonly string[]) {
    this.calls.push(`add:${urn}:${urns.join(',')}`)
    return urns.length
  }
  async removeItems(urn: string, ids: readonly string[]) {
    this.calls.push(`remove:${urn}:${ids.join(',')}`)
  }
  async setSaved(urn: string, saved: boolean) {
    this.calls.push(`save:${urn}:${saved}`)
  }
}

class SourcesStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async setLoved(urn: string, loved: boolean) {
    this.calls.push(`loved:${urn}:${loved}`)
  }
}

class PlayerStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  enqueueLast(urns: string[]) {
    this.calls.push(`enqueue:${urns.join(',')}`)
  }
}

class DownloadsStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'downloads')
  }
  async enqueue(urns: string[]) {
    this.calls.push(`download:${urns.join(',')}`)
    return []
  }
}

class UiStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'ui')
  }
  navigate(id: string, params?: Record<string, unknown>) {
    this.calls.push(`nav:${id}:${JSON.stringify(params ?? {})}`)
  }
}

async function harness(opts: { downloads?: boolean; player?: boolean; ui?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(LibraryStub)
  await ctx.plugin(SourcesStub)
  if (opts.player !== false) await ctx.plugin(PlayerStub)
  if (opts.downloads !== false) await ctx.plugin(DownloadsStub)
  if (opts.ui !== false) await ctx.plugin(UiStub)
  return {
    ctx,
    library: ctx.library as unknown as LibraryStub,
    sources: ctx.sources as unknown as SourcesStub,
    player: ctx.player as unknown as PlayerStub,
    downloads: ctx.downloads as unknown as DownloadsStub,
    ui: ctx.ui as unknown as UiStub,
  }
}

/** Run an item's handler as a press would. */
async function press(items: ReturnType<typeof trackMenuItems>, id: string): Promise<void> {
  const item = items.find((i) => i.id === id)
  expect(item, `item ${id}`).toBeTruthy()
  await item!.onSelect?.()
}

describe('trackMenuItems', () => {
  it('offers every action in the order the menu shows them', async () => {
    const h = await harness()
    const items = trackMenuItems(h.ctx, { track }, { playlists })
    expect(items.map((i) => i.id)).toEqual([
      'add-to-playlist',
      'remove-favourite',
      'enqueue',
      'download',
      'go-to-album',
    ])
  })

  it('omits what the build cannot do rather than offering a failing item', async () => {
    const h = await harness({ downloads: false, player: false, ui: false })
    const items = trackMenuItems(h.ctx, { track: { ...track, loved: false } }, {})
    expect(items.map((i) => i.id)).toEqual(['add-to-playlist'])
  })

  it('offers “remove from this playlist” only inside a playlist', async () => {
    const h = await harness()
    const outside = trackMenuItems(h.ctx, { track }, { playlists })
    expect(outside.some((i) => i.id === 'remove-from-playlist')).toBe(false)

    const inside = trackMenuItems(
      h.ctx,
      { track, playlistItemId: 'item-1' },
      { fromPlaylistUrn: 'BBeBee:local:playlist:1', playlists },
    )
    await press(inside, 'remove-from-playlist')
    expect(h.library.calls).toContain('remove:BBeBee:local:playlist:1:item-1')
  })

  it('unlikes through both stores, so the heart and the shelf agree', async () => {
    const h = await harness()
    await press(trackMenuItems(h.ctx, { track }, { playlists }), 'remove-favourite')
    expect(h.sources.calls).toEqual([`loved:${URN}:false`])
    expect(h.library.calls).toEqual([`save:${URN}:false`])
  })

  it('queues, downloads and navigates to the album', async () => {
    const h = await harness()
    const items = trackMenuItems(h.ctx, { track }, { playlists })
    await press(items, 'enqueue')
    await press(items, 'download')
    await press(items, 'go-to-album')

    expect(h.player.calls).toEqual([`enqueue:${URN}`])
    expect(h.downloads.calls).toEqual([`download:${URN}`])
    expect(h.ui.calls).toEqual([`nav:album.view:${JSON.stringify({ urn: ALBUM })}`])
  })
})

describe('the add-to-playlist submenu', () => {
  it('filters by a search field, offers create, then lists the playlists', () => {
    const submenu = addToPlaylistSubmenu(
      new LibraryStub(new Context()) as unknown as LibraryService,
      [URN],
      playlists,
    )
    expect(submenu?.searchPlaceholder).toBe('查找歌单')
    expect(submenu?.create?.label).toBe('新建歌单')
    expect(submenu?.items.map((i) => i.label)).toEqual(['Road trip', 'Loved'])
    // A smart playlist has no row an add could write, so it is disabled.
    expect(submenu?.items[1]?.disabled).toBe(true)
  })

  it('creates a playlist and adds the track to it in one press', async () => {
    const h = await harness()
    const submenu = addToPlaylistSubmenu(h.library as unknown as LibraryService, [URN], playlists)!
    await submenu.create?.onSelect('New mix')
    expect(h.library.calls).toEqual([
      'create:New mix',
      'add:BBeBee:local:playlist:new:BBeBee:local:track:1',
    ])
  })

  it('adds to an existing playlist from the list', async () => {
    const h = await harness()
    const submenu = addToPlaylistSubmenu(h.library as unknown as LibraryService, [URN], playlists)!
    await submenu.items[0]?.onSelect?.()
    expect(h.library.calls).toEqual(['add:BBeBee:local:playlist:1:BBeBee:local:track:1'])
  })
})

describe('playlistMenuItems', () => {
  it('saves, queues, downloads and copies the whole list', async () => {
    const h = await harness()
    const items = playlistMenuItems(
      h.ctx,
      { urn: 'BBeBee:local:playlist:1', name: 'Road trip' },
      [URN, 'BBeBee:local:track:2'],
      playlists,
    )
    expect(items.map((i) => i.id)).toEqual([
      'save-to-library',
      'enqueue',
      'download',
      'add-to-playlist',
    ])
    await press(items, 'save-to-library')
    await press(items, 'enqueue')
    await press(items, 'download')

    expect(h.library.calls).toEqual(['save:BBeBee:local:playlist:1:true'])
    expect(h.player.calls).toEqual([`enqueue:${URN},BBeBee:local:track:2`])
    expect(h.downloads.calls).toEqual([`download:${URN},BBeBee:local:track:2`])
  })

  it('drops the list actions when the tracks were never resolved', async () => {
    const h = await harness()
    const items = playlistMenuItems(h.ctx, { urn: 'u', name: 'n' }, [], [])
    // Nothing to queue, download or copy: only the save remains. An item that
    // would act on an empty list is worse than one that is absent.
    expect(items.map((i) => i.id)).toEqual(['save-to-library'])
  })
})

describe('collectionMenuItems', () => {
  it('acts on the collection’s track members, and offers no save', async () => {
    const h = await harness()
    const items = collectionMenuItems(h.ctx, [URN], playlists)
    expect(items.map((i) => i.id)).toEqual(['enqueue', 'download', 'add-to-playlist'])
    await press(items, 'enqueue')
    expect(h.player.calls).toEqual([`enqueue:${URN}`])
  })
})

describe('useTrackMenu', () => {
  it('opens with the track’s name and closes cleanly', async () => {
    const h = await harness()
    const { result } = renderHook(() => useTrackMenu(h.ctx))
    expect(result.current.menuProps.open).toBe(false)

    act(() => result.current.open({ track }, { x: 10, y: 20 }))
    expect(result.current.menuProps.open).toBe(true)
    expect(result.current.menuProps.x).toBe(10)
    expect(result.current.menuProps.title).toBe('Jóga')
    expect(result.current.menuProps.items.length).toBeGreaterThan(0)

    act(() => result.current.menuProps.onClose())
    expect(result.current.menuProps.open).toBe(false)
  })
})
