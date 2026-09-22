// @vitest-environment jsdom
/**
 * The desktop library screens, rendered and pressed.
 *
 * What matters here is the wiring the headless service cannot pin: a create
 * field that writes the trimmed name, a delete that names the right URN, a
 * remove control that passes the **item id** (the same track twice in a
 * playlist is two rows), and a smart playlist that draws no remove control at
 * all.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Collection, Paged, Playlist, PlaylistDetail, SavedKind, Track } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { CollectionScreen, FavoritesScreen, LibraryScreen, LocalMusicScreen, PlaylistDetailScreen, collectAllFolderTracks, inject } from './index.js'

afterEach(cleanup)

const TRACK = 'BBeBee:demo:track:one'
const PLAYLIST_URN = 'BBeBee:local:playlist:one'
const ALBUM_URN = 'BBeBee:demo:album:one'
const COLLECTION_ID = 'col-1'

const track: Track = {
  urn: TRACK,
  title: 'Alpha',
  artists: [{ urn: 'BBeBee:demo:artist:a', name: 'A', role: 'main', ordinal: 0 }],
}

const storedPlaylist: PlaylistDetail = {
  urn: PLAYLIST_URN,
  name: 'Road trip',
  trackCount: 1,
  items: [
    { id: 'item-1', trackUrn: TRACK, position: 'a' },
    { id: 'item-2', trackUrn: TRACK, position: 'b' },
  ],
  hasMore: false,
}

class LibraryStub extends Service {
  readonly calls: string[] = []
  playlists: Playlist[] = [storedPlaylist]
  collections: Collection[] = []
  saved: string[] = [TRACK]
  pinned: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'library')
  }

  async listPlaylists(): Promise<Paged<Playlist>> {
    return { items: this.playlists, hasMore: false }
  }
  async listCollections(): Promise<readonly Collection[]> {
    return this.collections
  }
  async createPlaylist(name: string): Promise<Playlist> {
    this.calls.push(`create:${name}`)
    return { urn: 'BBeBee:local:playlist:new', name, trackCount: 0 }
  }
  async deletePlaylist(urn: string): Promise<void> {
    this.calls.push(`delete:${urn}`)
  }
  async updatePlaylist(urn: string, patch: { name?: string; description?: string | null; artworkUrl?: string | null }): Promise<void> {
    this.calls.push(`update:${urn}:${JSON.stringify(patch)}`)
  }
  async createCollection(name: string): Promise<Collection> {
    this.calls.push(`collection:${name}`)
    return { id: 'c1', name, position: 'a', createdAt: 0 }
  }
  async deleteCollection(id: string): Promise<void> {
    this.calls.push(`collection-delete:${id}`)
  }
  async renameCollection(id: string, name: string): Promise<void> {
    this.calls.push(`rename-collection:${id}:${name}`)
  }
  async moveCollection(id: string, parentId: string | null): Promise<void> {
    this.calls.push(`move-collection:${id}:${parentId}`)
  }
  async addToCollection(id: string, urns: readonly string[]): Promise<number> {
    this.calls.push(`add-to-collection:${id}:${urns.join(',')}`)
    return urns.length
  }
  async listCollectionItems(id: string): Promise<Paged<{ urn: string; position: string }>> {
    return id === COLLECTION_ID
      ? {
          items: [
            { urn: TRACK, position: 'a' },
            { urn: ALBUM_URN, position: 'b' },
            { urn: PLAYLIST_URN, position: 'c' },
          ],
          hasMore: false,
        }
      : { items: [], hasMore: false }
  }
  async getPlaylist(urn: string): Promise<PlaylistDetail | undefined> {
    return urn === PLAYLIST_URN ? storedPlaylist : undefined
  }
  async listSaved(kind?: SavedKind): Promise<Paged<{ urn: string; kind: 'track' | 'album'; sourceId: string; addedAt: number; pinned?: boolean }>> {
    const items = this.saved.map((urn, index) => {
      const parsed = tryParseUrn(urn)
      const k = parsed?.kind === 'album' ? ('album' as const) : ('track' as const)
      return { urn, kind: k, sourceId: 'demo', addedAt: index, pinned: this.pinned.includes(urn) }
    })
    return {
      items: kind ? items.filter((it) => it.kind === kind) : items,
      hasMore: false,
    }
  }
  async setSaved(urn: string, saved: boolean): Promise<void> {
    this.calls.push(`save:${urn}:${saved}`)
    if (saved && !this.saved.includes(urn)) this.saved.push(urn)
    if (!saved) this.saved = this.saved.filter((u) => u !== urn)
  }
  async isSaved(urn: string): Promise<boolean> {
    return this.saved.includes(urn)
  }
  async setPinned(urn: string, pinned: boolean): Promise<void> {
    this.calls.push(`pin:${urn}:${pinned}`)
    if (pinned && !this.pinned.includes(urn)) this.pinned.push(urn)
    if (!pinned) this.pinned = this.pinned.filter((u) => u !== urn)
  }
  async removeItems(urn: string, itemIds: readonly string[]): Promise<void> {
    this.calls.push(`remove:${urn}:${itemIds.join(',')}`)
  }
}

class PlayerStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  async playFromContext(urn: string, urns?: readonly string[]): Promise<void> {
    this.calls.push(`${urn} <- ${urns?.length ?? 0}`)
  }
  async playNow(urns: readonly string[]): Promise<void> {
    this.calls.push(`now:${urns.join(',')}`)
  }
  async getHistory(): Promise<any[]> {
    return []
  }
}

class SourcesStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async getTracks(urns: readonly string[]): Promise<Track[]> {
    return urns.includes(TRACK) ? [track] : []
  }
  async listTracks() {
    return { items: [track], hasMore: false }
  }
  async listAlbums() {
    return { items: [], hasMore: false }
  }
  async getAlbum(urn: string) {
    return urn === ALBUM_URN
      ? { urn, title: 'Homogenic', artists: [{ urn: 'a', name: 'Björk', role: 'main', ordinal: 0 }] }
      : undefined
  }
  async getArtist() {
    return undefined
  }
}

class UiStub extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'ui')
  }
  navigate(id: string, params?: Record<string, unknown>): void {
    this.calls.push(`${id}:${JSON.stringify(params ?? {})}`)
  }
}

async function harness() {
  const root = new Context()
  await root.plugin(LibraryStub)
  await root.plugin(PlayerStub)
  await root.plugin(SourcesStub)
  await root.plugin(UiStub)
  let scoped: Context | undefined
  root.inject(inject, (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('no scoped context')
  return {
    ctx: scoped,
    library: root.library as unknown as LibraryStub,
    player: root.player as unknown as PlayerStub,
    ui: root.ui as unknown as UiStub,
  }
}

/** React tracks the last value it wrote, so a controlled field needs the native setter. */
function type(field: HTMLElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('LibraryScreen', () => {
  it('renders the playlists and creates a trimmed one', async () => {
    const { ctx, library } = await harness()
    await withListLayout(async () => {
      const { container, getByTestId } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('Road trip')
      await act(async () => {
        type(getByTestId('playlists-new-name'), '  New mix  ')
        await tick()
      })
      await act(async () => {
        ;(getByTestId('playlists-create') as HTMLElement).click()
        await tick()
      })
    })

    expect(library.calls).toContain('create:New mix')
  })

  it('deletes and opens by the playlist URN', async () => {
    const { ctx, library, ui } = await harness()
    await withListLayout(async () => {
      const { getByLabelText, getByText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      await act(async () => {
        getByLabelText('Delete Road trip').click()
        getByText('Road trip').click()
        await tick()
      })
    })

    expect(library.calls).toContain(`delete:${PLAYLIST_URN}`)
    expect(ui.calls).toContain(`library.playlist:{"urn":"${PLAYLIST_URN}"}`)
  })

  it('renders unified list with special rows, playlists, albums, and collections', async () => {
    const { ctx, library, ui } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    library.saved = [TRACK, ALBUM_URN]
    await withListLayout(async () => {
      const { container, getByText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('最喜欢的音乐')
      expect(container.textContent).toContain('本地音乐')
      expect(container.textContent).toContain('Road trip')
      expect(container.textContent).toContain('Ambient mix')
      expect(container.textContent).toContain('Homogenic')

      await act(async () => {
        getByText('本地音乐').click()
        await tick()
      })
      expect(ui.calls).toContain('library.local:{}')

      await act(async () => {
        getByText('最喜欢的音乐').click()
        await tick()
      })
      expect(ui.calls).toContain('library.favorites:{}')
    })
  })

  it('filters items by top toggle buttons (歌单, 专辑, 目录, 已下载)', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    library.saved = [TRACK, ALBUM_URN]
    await withListLayout(async () => {
      const { container, getByText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Click '歌单'
      await act(async () => {
        getByText('歌单').click()
        await tick()
      })
      expect(container.textContent).toContain('Road trip')
      expect(container.textContent).toContain('最喜欢的音乐')
      expect(container.textContent).not.toContain('Homogenic')
      expect(container.textContent).not.toContain('Ambient mix')

      // Click '专辑'
      await act(async () => {
        getByText('专辑').click()
        await tick()
      })
      expect(container.textContent).toContain('Homogenic')
      expect(container.textContent).not.toContain('Road trip')
      expect(container.textContent).not.toContain('Ambient mix')

      // Toggle off by clicking '专辑' again
      await act(async () => {
        getByText('专辑').click()
        await tick()
      })
      expect(container.textContent).toContain('Road trip')
      expect(container.textContent).toContain('Homogenic')
    })
  })

  it('searches items via search input', async () => {
    const { ctx, library } = await harness()
    library.saved = [TRACK, ALBUM_URN]
    await withListLayout(async () => {
      const { container, getByLabelText, getByTestId } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Open search input
      await act(async () => {
        getByLabelText('搜索').click()
        await tick()
      })

      // Type query
      await act(async () => {
        type(getByTestId('library-search-input'), 'Road')
        await tick()
      })

      expect(container.textContent).toContain('Road trip')
      expect(container.textContent).not.toContain('Homogenic')
    })
  })

  it('plays playlist content when clicking the cover play overlay', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getByText, getByTitle } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const row = getByText('Road trip').closest('[style*="cursor: pointer"]') as HTMLElement
      expect(row).toBeTruthy()

      // Hover row to reveal cover play button
      await act(async () => {
        fireEvent.mouseEnter(row)
        await tick()
      })

      const playOverlay = getByTitle('播放 Road trip')
      expect(playOverlay).toBeTruthy()

      await act(async () => {
        playOverlay.click()
        await tick()
      })
    })

    expect(player.calls).toContain(`${TRACK} <- 2`)
  })

  it('pins a playlist via context menu', async () => {
    const { ctx, library } = await harness()
    library.playlists = [
      storedPlaylist,
      { urn: 'BBeBee:local:playlist:two', name: 'Zebra playlist', trackCount: 0 },
    ]
    library.saved = [TRACK]
    await withListLayout(async () => {
      const { getByText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const zebraRow = getByText('Zebra playlist').closest('[style*="cursor: pointer"]') as HTMLElement
      expect(zebraRow).toBeTruthy()

      await act(async () => {
        fireEvent.contextMenu(zebraRow)
        await tick()
      })

      const pinItem = getByText('置顶歌单')
      expect(pinItem).toBeTruthy()

      await act(async () => {
        pinItem.click()
        await tick()
      })

      expect(library.calls).toContain('pin:BBeBee:local:playlist:two:true')
    })
  })

  it('toggles folder inline expansion with downward/upward triangle arrow in standard mode', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByLabelText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const expandBtn = getByLabelText('展开文件夹')
      expect(expandBtn).toBeTruthy()

      // Click to expand inline
      await act(async () => {
        expandBtn.click()
        await tick()
      })

      const foldBtn = getByLabelText('折叠文件夹')
      expect(foldBtn).toBeTruthy()

      // Click to fold inline
      await act(async () => {
        foldBtn.click()
        await tick()
      })

      expect(getByLabelText('展开文件夹')).toBeTruthy()
    })
  })

  it('navigates into folder view in sidebar mode and returns with back button', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByText, getByTitle, queryByTitle } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Click folder item to open folder view
      await act(async () => {
        getByText('Ambient mix').click()
        await tick()
      })

      // In folder view: back button is rendered
      const backBtn = getByTitle('返回音乐库')
      expect(backBtn).toBeTruthy()

      // Click back button to return to root library
      await act(async () => {
        backBtn.click()
        await tick()
      })

      expect(queryByTitle('返回音乐库')).toBeNull()
      expect(getByText('音乐库')).toBeTruthy()
    })
  })

  it('renders return button in collapsed mode when inside a folder and returns to root collapsed library', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByLabelText, queryByLabelText } = render(
        h(LibraryScreen, { ctx, mode: 'collapsed', folderId: 'col-1' }),
      )
      await act(async () => {
        await tick()
      })

      const backBtn = getByLabelText('返回音乐库')
      expect(backBtn).toBeTruthy()

      await act(async () => {
        backBtn.click()
        await tick()
      })

      expect(queryByLabelText('返回音乐库')).toBeNull()
    })
  })

  it('renders breadcrumb in expanded mode when inside a folder and returns to root expanded library', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'Ambient mix', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByText, getByTitle, queryByTitle } = render(
        h(LibraryScreen, { ctx, mode: 'expanded', folderId: 'col-1' }),
      )
      await act(async () => {
        await tick()
      })

      expect(getByText('Ambient mix')).toBeTruthy()
      const backNav = getByTitle('返回音乐库')
      expect(backNav).toBeTruthy()

      await act(async () => {
        backNav.click()
        await tick()
      })

      expect(queryByTitle('返回音乐库')).toBeNull()
      expect(getByText('音乐库')).toBeTruthy()
    })
  })

  it('opens edit details modal and updates playlist', async () => {
    const { ctx, library } = await harness()
    library.playlists = [storedPlaylist]
    await withListLayout(async () => {
      const { getByText, getByTestId } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const row = getByText('Road trip').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(row)
        await tick()
      })

      const editItem = getByText('编辑详情')
      expect(editItem).toBeTruthy()

      await act(async () => {
        editItem.click()
        await tick()
      })

      const nameInput = getByTestId('edit-playlist-name') as HTMLInputElement
      expect(nameInput.value).toBe('Road trip')

      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Road trip 2026' } })
        fireEvent.change(getByTestId('edit-playlist-description'), { target: { value: 'Best songs' } })
        fireEvent.change(getByTestId('edit-playlist-artwork'), { target: { value: 'https://example.com/art.jpg' } })
      })

      await act(async () => {
        ;(getByTestId('edit-playlist-save') as HTMLElement).click()
        await tick()
      })

      expect(library.calls).toContain(
        `update:${PLAYLIST_URN}:${JSON.stringify({
          name: 'Road trip 2026',
          description: 'Best songs',
          artworkUrl: 'https://example.com/art.jpg',
        })}`,
      )
    })
  })

  it('opens rename collection modal and renames collection', async () => {
    const { ctx, library } = await harness()
    library.collections = [{ id: 'col-1', name: 'My Folder', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByText, getByTestId } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const row = getByText('My Folder').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(row)
        await tick()
      })

      const renameItem = getByText('重命名')
      expect(renameItem).toBeTruthy()

      await act(async () => {
        renameItem.click()
        await tick()
      })

      const input = getByTestId('rename-collection-name') as HTMLInputElement
      expect(input.value).toBe('My Folder')

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Renamed Folder' } })
        ;(getByTestId('rename-collection-save') as HTMLElement).click()
        await tick()
      })

      expect(library.calls).toContain('rename-collection:col-1:Renamed Folder')
    })
  })

  it('deletes playlist and collection via context menu', async () => {
    const { ctx, library } = await harness()
    library.playlists = [storedPlaylist]
    library.collections = [{ id: 'col-1', name: 'My Folder', position: 'a', createdAt: 0 }]
    await withListLayout(async () => {
      const { getByText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Delete playlist
      const playlistRow = getByText('Road trip').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(playlistRow)
        await tick()
      })
      const deletePlaylistItem = getByText('删除')
      expect(deletePlaylistItem).toBeTruthy()
      await act(async () => {
        deletePlaylistItem.click()
        await tick()
      })
      expect(library.calls).toContain(`delete:${PLAYLIST_URN}`)

      // Delete collection
      const folderRow = getByText('My Folder').closest('[style*="cursor: pointer"]') as HTMLElement
      await act(async () => {
        fireEvent.contextMenu(folderRow)
        await tick()
      })
      const deleteFolderItem = getByText('删除')
      expect(deleteFolderItem).toBeTruthy()
      await act(async () => {
        deleteFolderItem.click()
        await tick()
      })
      expect(library.calls).toContain('collection-delete:col-1')
    })
  })
})

describe('collectAllFolderTracks', () => {
  it('recursively gathers tracks from nested folders, playlists, and albums', async () => {
    const { ctx, library } = await harness()
    const colRoot: Collection = { id: 'root', name: 'Root Folder', position: 'a', createdAt: 0 }
    const colChild: Collection = { id: 'child', parentId: 'root', name: 'Child Folder', position: 'b', createdAt: 0 }
    library.collections = [colRoot, colChild]
    library.listCollectionItems = async (id: string) => {
      if (id === 'root') {
        return {
          items: [
            { urn: 'BBeBee:demo:track:root-1', position: 'a' },
            { urn: PLAYLIST_URN, position: 'b' },
          ],
          hasMore: false,
        }
      }
      if (id === 'child') {
        return {
          items: [
            { urn: 'BBeBee:demo:track:child-1', position: 'a' },
            { urn: ALBUM_URN, position: 'b' },
          ],
          hasMore: false,
        }
      }
      return { items: [], hasMore: false }
    }

    const albumsMap = new Map([
      [ALBUM_URN, { urn: ALBUM_URN, title: 'Album', tracks: [{ urn: 'BBeBee:demo:track:album-1', title: 'T' }] } as any],
    ])

    const tracks = await collectAllFolderTracks(ctx, 'root', library.collections, albumsMap)
    expect(tracks).toContain('BBeBee:demo:track:root-1')
    expect(tracks).toContain(TRACK)
    expect(tracks).toContain('BBeBee:demo:track:child-1')
    expect(tracks).toContain('BBeBee:demo:track:album-1')
  })
})

describe('PlaylistDetailScreen', () => {
  it('plays a tapped track with the whole playlist as its context', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { container } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
      await act(async () => {
        await tick()
      })
      const row = container.querySelector('[role="row"]') as HTMLElement | null
      expect(row, 'the track is on screen').toBeTruthy()
      row!.click()
      await tick()
    })

    expect(player.calls[0]).toBe(`${TRACK} <- 2`)
  })

  it('removes the item, not every row that shares its track', async () => {
    const { ctx, library } = await harness()
    await withListLayout(async () => {
      const { getAllByLabelText } = render(h(PlaylistDetailScreen, { ctx, urn: PLAYLIST_URN }))
      await act(async () => {
        await tick()
      })

      // Two rows share one track; the first remove names the first item.
      await act(async () => {
        getAllByLabelText('Remove Alpha from Road trip')[0]!.click()
        await tick()
      })
    })

    expect(library.calls).toEqual([`remove:${PLAYLIST_URN}:item-1`])
  })
})

describe('FavoritesScreen', () => {
  it('unsaves a row through the library service', async () => {
    const { ctx, library } = await harness()
    await withListLayout(async () => {
      const { getByLabelText } = render(h(FavoritesScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      await act(async () => {
        getByLabelText('Remove Alpha from favourites').click()
        await tick()
      })
    })

    expect(library.calls).toContain(`save:${TRACK}:false`)
  })
})


describe('CollectionScreen', () => {
  it('renders tracks, albums and playlists as folder members', async () => {
    const { ctx, ui } = await harness()
    await withListLayout(async () => {
      const { container, getByText } = render(h(CollectionScreen, { ctx, id: COLLECTION_ID }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('Alpha')
      expect(container.textContent).toContain('Homogenic')
      expect(container.textContent).toContain('Road trip')

      await act(async () => {
        getByText('Homogenic').click()
        await tick()
      })
      expect(ui.calls).toContain(`album.view:{"urn":"${ALBUM_URN}"}`)
    })
  })
})

describe('LocalMusicScreen', () => {
  it('renders local tracks and plays all on button press', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { container, getByTestId } = render(h(LocalMusicScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('本地音乐')
      expect(container.textContent).toContain('Alpha')

      await act(async () => {
        ;(getByTestId('local-music-play') as HTMLElement).click()
        await tick()
      })
    })

    expect(player.calls).toContain(`now:${TRACK}`)
  })
})

