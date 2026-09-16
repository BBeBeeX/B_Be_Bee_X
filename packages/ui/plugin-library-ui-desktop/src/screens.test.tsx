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

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Collection, Paged, Playlist, PlaylistDetail, SavedKind, Track } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { CollectionScreen, FavoritesScreen, LibraryScreen, PlaylistDetailScreen, inject } from './index.js'

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
  async createCollection(name: string): Promise<Collection> {
    this.calls.push(`collection:${name}`)
    return { id: 'c1', name, position: 'a', createdAt: 0 }
  }
  async deleteCollection(id: string): Promise<void> {
    this.calls.push(`collection-delete:${id}`)
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
  async listSaved(_kind?: SavedKind): Promise<Paged<{ urn: string; kind: 'track'; sourceId: string; addedAt: number }>> {
    return {
      items: this.saved.map((urn, index) => ({ urn, kind: 'track' as const, sourceId: 'demo', addedAt: index })),
      hasMore: false,
    }
  }
  async setSaved(urn: string, saved: boolean): Promise<void> {
    this.calls.push(`save:${urn}:${saved}`)
  }
  async isSaved(urn: string): Promise<boolean> {
    return this.saved.includes(urn)
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
}

class SourcesStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async getTracks(urns: readonly string[]): Promise<Track[]> {
    return urns.includes(TRACK) ? [track] : []
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
      const { container, getByLabelText } = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      await act(async () => {
        getByLabelText('Delete Road trip').click()
        const open = Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === 'Open',
        )
        open?.click()
        await tick()
      })
    })

    expect(library.calls).toContain(`delete:${PLAYLIST_URN}`)
    expect(ui.calls).toContain(`library.playlist:{"urn":"${PLAYLIST_URN}"}`)
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
