// @vitest-environment jsdom
/**
 * The import and test screens.
 *
 * Rendered against a real `ctx.sources`, because what is worth pinning is the
 * *interaction*: what a paste shows before it commits, and what a source's
 * test areas offer for a given document. A mocked service would define both
 * of those away.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import sourcesPlugin from '@BBeBee/plugin-sources'
import type {
  AlbumDetail,
  Capabilities,
  MediaProvider,
  SearchQuery,
  SearchResult,
  Track,
} from '@BBeBee/protocol'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { ImportScreen, LibraryScreen, SearchScreen, SourcesListScreen, TestScreen, inject } from './index.js'

// Testing Library auto-cleans only with vitest globals, which this repo does
// not enable. Without this every render stacks up in one document and
// `screen` queries find the previous test's screen.
afterEach(cleanup)

/**
 * The context a view actually gets — scoped, not root.
 *
 * ⚠️ This distinction is the whole reason this helper exists. `new Context()`
 * answers `undefined` for a service nobody registered; a **plugin-scoped**
 * context throws `cannot get property "x" without inject` for anything not
 * declared, and a scoped context is the only kind a shell ever hands a view.
 *
 * Every view test in this repo used the root kind, so `ctx.player?.playNow()`
 * read as a safe optional everywhere in CI and threw on a device the moment
 * anyone tapped a track. Rendering against the real shape is what makes that
 * a failing test rather than a bug report.
 */
async function harness(): Promise<{ ctx: Context; admin: Context }> {
  const root = new Context()
  await root.plugin(PathsNode, { root: await tempDir('bbebee-screens') })
  await root.plugin(FsNode)
  await root.plugin(DbNode, { fileName: ':memory:' })
  await root.plugin(sourcesPlugin, {})
  await tick()

  /*
   * Scoped to **this package's own `inject`**, minus `ui` (which the harness
   * does not load and no screen reads).
   *
   * Derived rather than written out, so the two cannot drift: if a screen
   * starts reading a service the package never declared, the read throws here
   * exactly as it would in the app. `admin` is the root, for arranging
   * fixtures the view itself would have no business reaching.
   */
  const declared = inject.filter((name) => name !== 'ui')
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('screens harness: no scoped context')
  return { ctx: scoped, admin: root }
}

const DOC = {
  sourceUrl: 'https://music.example.org',
  sourceName: 'Example',
  ruleStream: { url: '={{source.url}}/s' },
}

/**
 * A provider with exactly the features the test asks for.
 *
 * The areas on the test screen follow the provider's shape — capability flags
 * for search/browse/library, method presence for album/artist/playlist/
 * lyrics — so a hand-built provider pins that mapping deterministically,
 * without loading the source runtime to get one.
 */
function providerWith(
  sourceId: string,
  features: { search?: boolean; album?: boolean; lyrics?: boolean },
): MediaProvider {
  const capabilities: Capabilities = {
    search: {
      tracks: features.search ?? false,
      albums: false,
      artists: false,
      playlists: false,
      fullText: false,
    },
    browse: false,
    lyrics: features.lyrics ?? false,
    artwork: false,
    library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
    streaming: { qualities: ['normal'], transcoding: false, seekable: true, urlExpiry: false },
    regional: false,
  }
  return {
    sourceId,
    displayName: sourceId,
    capabilities,
    auth: {
      flow: { kind: 'none' },
      status: { state: 'authenticated' },
      async signIn() {},
      async signOut() {},
      onStatusChange: () => () => {},
    },
    async getTrack() {
      throw new Error('not needed')
    },
    async resolveStream() {
      return { kind: 'remote', target: 'https://music.example.org/s', seekable: true } as never
    },
    ping: async () => true,
    ...(features.album
      ? {
          getAlbum: async (): Promise<AlbumDetail> => ({
            urn: '',
            id: '',
            title: '',
          }) as never,
        }
      : {}),
  }
}

function type(testID: string, value: string): void {
  const field = screen.getByTestId(testID) as HTMLTextAreaElement
  // React tracks the last value it wrote, so assigning `.value` directly is
  // ignored on the next render. Going through the native setter is what makes
  // a controlled input see the change.
  const setter = Object.getOwnPropertyDescriptor(
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )!.set!
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ImportScreen', () => {
  it('names what a paste would add, before writing anything', async () => {
    const { ctx } = await harness()
    render(h(ImportScreen, { ctx }))

    await act(async () => {
      type('source-import-input', JSON.stringify([DOC, { ...DOC, sourceUrl: 'https://b.example', sourceName: 'Second' }]))
      await tick()
    })

    expect(screen.getByLabelText('What will be imported')).toBeTruthy()
    expect(screen.getByText('Example')).toBeTruthy()
    expect(screen.getByText('Second')).toBeTruthy()
    expect(ctx.sources.sources, 'nothing written yet').toHaveLength(0)
  })

  it('will not import an empty box', async () => {
    // Disabled rather than erroring: there is nothing to say about a paste
    // that has not happened.
    await harness().then(({ ctx }) => render(h(ImportScreen, { ctx })))
    expect((screen.getByTestId('source-import-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('imports, and says what it did', async () => {
    const { ctx } = await harness()
    render(h(ImportScreen, { ctx }))

    await act(async () => {
      type('source-import-input', JSON.stringify(DOC))
      await tick()
    })
    await act(async () => {
      screen.getByTestId('source-import-submit').click()
      await tick()
      await tick()
    })

    expect(ctx.sources.sources).toHaveLength(1)
    expect(screen.getByText('1 added')).toBeTruthy()
  })

  it('shows every problem with a bad paste, and keeps the text', async () => {
    /*
     * Two things a screen gets wrong here: clearing the box on failure (losing
     * what the user was fixing), and showing one issue at a time (the misery
     * the multi-issue error exists to avoid).
     */
    const { ctx } = await harness()
    render(h(ImportScreen, { ctx }))

    await act(async () => {
      type('source-import-input', '{"sourceName": 42}')
      await tick()
    })
    await act(async () => {
      screen.getByTestId('source-import-submit').click()
      await tick()
      await tick()
    })

    const field = screen.getByTestId('source-import-input') as HTMLTextAreaElement
    expect(field.value, 'still there to fix').toBe('{"sourceName": 42}')
    const shown = document.body.textContent ?? ''
    expect(shown).toContain('sourceUrl')
    expect(shown).toContain('ruleStream')
  })
})

describe('TestScreen', () => {
  it('offers a test area per feature the source implements, and no more', async () => {
    // The areas on screen follow the provider's own shape — and the list of
    // areas *is* the list of features.
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    ctx.sources.register(providerWith(ctx.sources.sources[0]!.id, { search: true, album: true }))

    render(h(TestScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    await act(async () => {
      await tick()
    })

    expect(screen.getByLabelText('Source to test')).toBeTruthy()
    expect(screen.getByText('Search')).toBeTruthy()
    expect(screen.getByText('Album')).toBeTruthy()
    expect(screen.getByText('Stream')).toBeTruthy()
    expect(screen.getByText('HTTP request — through this source\'s own client')).toBeTruthy()
    expect(screen.getByText("Script — the document's functions are in scope")).toBeTruthy()
    expect(screen.queryByText('Lyrics')).toBeNull()
    expect(screen.queryByText('Artist')).toBeNull()
    expect(screen.queryByText('Playlist')).toBeNull()
    expect(screen.queryByText('Library list')).toBeNull()
  })

  it('defaults the selector to the first source and shows it', async () => {
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify([DOC, { ...DOC, sourceUrl: 'https://b.example', sourceName: 'Second' }]))
    await tick()

    render(h(TestScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    const select = screen.getByLabelText('Source to test') as HTMLSelectElement
    expect(select.value).toBe(ctx.sources.sources[0]!.id)
    expect(select.options).toHaveLength(2)
  })

  it('says there is no trace yet rather than showing an empty list', async () => {
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    render(h(TestScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    await act(async () => {
      await tick()
    })
    expect(screen.getByText('No trace yet')).toBeTruthy()
  })
})

describe('LibraryScreen', () => {
  /** A track in the catalogue, written the way the scanner would. */
  async function withTrack(admin: Context): Promise<void> {
    await admin.db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES ('local', 'bbebee://local/local', 'This device', '{}', 'h', 0, 0)`,
    )
    await admin.db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, fetched_at)
       VALUES ('BBeBee:local:track:1', 'local', '1', 'Jóga', 0)`,
    )
  }

  it('plays a track without a player loaded, instead of throwing', async () => {
    /*
     * The device bug, exactly.
     *
     * `ctx.player?.playNow(...)` reads as a safe optional and is not one: on a
     * plugin-scoped context cordis throws for any property that was not
     * injected, so the `?.` never gets the chance to short-circuit. Every test
     * missed it because every test built a *root* context, where the same read
     * answers `undefined`.
     *
     * `plugin-player` is deliberately absent here, which is the ordinary state
     * while it is still loading — and the state a user taps into.
     */
    const { ctx, admin } = await harness()
    await withTrack(admin)

    const container = await withListLayout(async () => {
      const view = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view.container
    })

    const row = container.querySelector('[role="row"]') as HTMLElement | null
    expect(row, 'the track is on screen').toBeTruthy()
    expect(row!.textContent).toContain('Jóga')

    /*
     * Collected, not caught.
     *
     * React dispatches its own events, so a handler that throws does not
     * propagate out of `.click()` — it is reported. That is precisely why this
     * reached a device as a bare `[Error: …]` in LogBox instead of failing
     * anything, and why `expect(...).not.toThrow()` would pass while the bug
     * was still there.
     */
    const reported: unknown[] = []
    const onError = (event: ErrorEvent) => {
      reported.push(event.error ?? event.message)
      event.preventDefault()
    }
    window.addEventListener('error', onError)
    try {
      row!.click()
    } finally {
      window.removeEventListener('error', onError)
    }

    expect(
      reported.map(String),
      'tapping a track with no player must be a no-op, not an uncaught error',
    ).toEqual([])
  })

  it('plays the track in its list context on click, staying on the library', async () => {
    const { admin } = await harness()
    await withTrack(admin)

    const calls: string[] = []
    class PlayerStub extends Service {
      constructor(c: Context) { super(c, 'player') }
      playNow = async (urns: string[]) => void calls.push(`play:${urns.join(',')}`)
      playFromContext = async (urn: string, contextUrns: readonly string[] = []) =>
        void calls.push(`play:${urn}|context:${contextUrns.join(',')}`)
    }
    class UiStub extends Service {
      constructor(c: Context) { super(c, 'ui') }
      navigate = (id: string) => void calls.push(`nav:${id}`)
    }
    await admin.plugin(PlayerStub)
    await admin.plugin(UiStub)
    await tick()

    let scoped: Context | undefined
    admin.inject(['sources', 'ui', 'player'], (s) => void (scoped = s))
    await tick()

    await withListLayout(async () => {
      const view = render(h(LibraryScreen, { ctx: scoped! }))
      await act(async () => {
        await tick()
      })

      const row = view.container.querySelector('[role="row"]') as HTMLElement
      expect(row).toBeTruthy()
      await act(async () => {
        row.click()
        await tick()
      })

      // A tap plays the track in the list it was tapped in: the whole library
      // (one track here) goes with it as the queue context — and the user
      // stays where they are; playback announces itself in the bar.
      expect(calls).toContain('play:BBeBee:local:track:1|context:BBeBee:local:track:1')
      expect(calls, 'no navigation to the player').not.toContain('nav:player.now-playing')
    })
  })

  it('queues a library track for download, through the service', async () => {
    const { ctx, admin } = await harness()
    await withTrack(admin)
    const queued: string[] = []
    class DownloadsStub extends Service {
      constructor(c: Context) {
        super(c, 'downloads')
      }
      async enqueue(urns: string[]) {
        queued.push(...urns)
        return []
      }
    }
    await admin.plugin(DownloadsStub)
    await tick()

    await withListLayout(async () => {
      const view = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      const button = view.container.querySelector('[aria-label="Download"]') as HTMLElement | null
      expect(button, 'the row offers a download control').toBeTruthy()
      await act(async () => {
        button!.click()
        await tick()
      })
      expect(queued).toEqual(['BBeBee:local:track:1'])
    })
  })

  it('switches between all, local, and favorites scopes', async () => {
    const { ctx, admin } = await harness()
    await withTrack(admin)

    await withListLayout(async () => {
      const view = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      // Initially "All" scope shows the track
      expect(view.container.textContent).toContain('Jóga')

      // Find the Favorites button and click it
      const favoritesBtn = Array.from(view.container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Favorites',
      )
      expect(favoritesBtn).toBeTruthy()

      await act(async () => {
        favoritesBtn!.click()
        await tick()
      })

      // In favorites scope, since Jóga is not loved yet, empty state is shown
      expect(view.container.textContent).toContain('No favorites yet')

      // Click "Local" button
      const localBtn = Array.from(view.container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Local',
      )
      expect(localBtn).toBeTruthy()

      await act(async () => {
        localBtn!.click()
        await tick()
      })

      // In local scope, Jóga is from 'local' source so it appears
      expect(view.container.textContent).toContain('Jóga')
    })
  })
})

describe('SearchScreen', () => {
  const track = (sourceId: string, id: string, title: string): Track => ({
    urn: `BBeBee:${sourceId}:track:${id}`,
    title,
    artists: [
      { urn: `BBeBee:${sourceId}:artist:${id}`, name: 'Someone', role: 'main', ordinal: 0 },
    ],
  })

  /** A provider whose only feature is search — the screen's one dependency. */
  function searchingProvider(
    sourceId: string,
    search: (query: SearchQuery) => Promise<SearchResult>,
  ): MediaProvider {
    const base = providerWith(sourceId, {})
    return {
      ...base,
      capabilities: {
        ...base.capabilities,
        search: { tracks: true, albums: false, artists: false, playlists: false, fullText: false },
      },
      search,
    }
  }

  const DOCS = [
    { sourceUrl: 'https://alpha.example', sourceName: 'Alpha', ruleStream: { url: '={{source.url}}/s' } },
    { sourceUrl: 'https://beta.example', sourceName: 'Beta', ruleStream: { url: '={{source.url}}/s' } },
  ]

  async function withTwoSources(admin: Context): Promise<void> {
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
  }

  function registerHits(
    admin: Context,
    id: string,
    title: string,
  ): void {
    admin.sources.register(
      searchingProvider(id, async () => ({ tracks: { items: [track(id, '1', title)], hasMore: false } })),
    )
  }

  it('shows the search box and the source toggles before anything is searched', async () => {
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha, beta] = admin.sources.sources.map((record) => record.id)

    render(h(SearchScreen, { ctx }))

    expect(screen.getByTestId('search-input')).toBeTruthy()
    expect(screen.getByTestId(`search-source-${alpha}-track`)).toBeTruthy()
    expect(screen.getByTestId(`search-source-${beta}-track`)).toBeTruthy()
    // Nothing asked, nothing shown — and no empty-results screen either.
    expect(screen.queryByLabelText('Search results')).toBeNull()
  })

  it('lists each selected source under its own heading', async () => {
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha, beta] = admin.sources.sources
    registerHits(admin, alpha!.id, 'Alpha Song')
    registerHits(admin, beta!.id, 'Beta Song')
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      const shown = document.body.textContent ?? ''
      expect(shown).toContain('Alpha')
      expect(shown).toContain('Beta')
      expect(shown).toContain('Alpha Song')
      expect(shown).toContain('Beta Song')
      expect(shown).toContain('1 track')
    })
  })

  it('reports a failing source instead of dropping it, and still shows the rest', async () => {
    /*
     * The reason `searchAll` returns per-source entries and never merges: a
     * backend that is down must be visible. A merged list would make "Alpha is
     * broken" and "Alpha has no match" the same screen.
     */
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha, beta] = admin.sources.sources
    admin.sources.register(
      searchingProvider(alpha!.id, async () => {
        throw new Error('Alpha is down')
      }),
    )
    registerHits(admin, beta!.id, 'Beta Song')
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      const shown = document.body.textContent ?? ''
      expect(shown).toContain('Alpha is down')
      expect(shown).toContain('Beta Song')
    })
  })

  it('only asks the sources the user left toggled on', async () => {
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha, beta] = admin.sources.sources
    registerHits(admin, alpha!.id, 'Alpha Song')
    registerHits(admin, beta!.id, 'Beta Song')
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      await act(async () => {
        screen.getByTestId(`search-source-${alpha!.id}-track`).click()
      })
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      const shown = document.body.textContent ?? ''
      expect(shown).toContain('Beta Song')
      expect(shown, 'the toggled-off source was not asked').not.toContain('Alpha Song')
    })
  })

  it('gives songs and artists their own toggle, and passes the halves through', async () => {
    /*
     * A backend whose user search is a separate endpoint — Bilibili, for one —
     * has two searchable interfaces. Turning the artist half off must reach
     * the provider as `types: ['track']`, so it does not fetch the second
     * document; that per-source filter is what the interface toggles *mean*.
     */
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const alpha = admin.sources.sources[0]!

    const seen: SearchQuery[] = []
    const base = providerWith(alpha.id, {})
    admin.sources.register({
      ...base,
      capabilities: {
        ...base.capabilities,
        search: { tracks: true, albums: false, artists: true, playlists: false, fullText: false },
      },
      search: async (query) => {
        seen.push(query)
        return { tracks: { items: [track(alpha.id, '1', 'Alpha Song')], hasMore: false } }
      },
    })
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      expect(screen.getByTestId(`search-source-${alpha.id}-track`)).toBeTruthy()
      const artists = screen.getByTestId(`search-source-${alpha.id}-artist`)

      await act(async () => {
        artists.click()
      })
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      expect(seen).toHaveLength(1)
      expect(seen[0]!.types, 'artist half turned off').toEqual(['track'])
    })
  })
})

describe('SourcesListScreen', () => {
  it('toggles a source off and on, and the row follows', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOC))
    await tick()
    const id = admin.sources.sources[0]!.id

    render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      screen.getByTestId(`sources-list-toggle-${id}`).click()
      await tick()
    })
    expect(ctx.sources.source(id)?.enabled).toBe(false)

    await act(async () => {
      screen.getByTestId(`sources-list-toggle-${id}`).click()
      await tick()
    })
    expect(ctx.sources.source(id)?.enabled).toBe(true)
  })

  it('deletes a source only after the confirmation is pressed', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOC))
    await tick()
    const id = admin.sources.sources[0]!.id

    render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    // The first press asks; it must not take the cached library with it.
    await act(async () => {
      screen.getByTestId(`sources-list-delete-${id}`).click()
      await tick()
    })
    expect(ctx.sources.source(id), 'the trash can only opens the question').toBeTruthy()

    await act(async () => {
      screen.getByTestId(`sources-list-delete-confirm-${id}`).click()
      await tick()
      await tick()
    })
    expect(ctx.sources.source(id)).toBeUndefined()
  })

  it('shows the local source its folders, with folder controls', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOC))
    await admin.db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES ('local', 'bbebee://local/local', 'This device', '{}', 'h', 0, 0)`,
    )
    // Refreshes the service's mirror of the table.
    await admin.sources.setEnabled('local', true)

    const calls: string[] = []
    class ScannerStub extends Service {
      constructor(c: Context) {
        super(c, 'scanner')
      }
      specifiedDirs = [
        { id: 'dir-1', uri: 'file:///music', recursive: true, enabled: true },
      ] as never
      addSpecifiedDir = async () => {
        throw new Error('not needed')
      }
      removeSpecifiedDir = async (dirId: string) => void calls.push(`remove:${dirId}`)
      setEnabled = async (dirId: string, on: boolean) => void calls.push(`enable:${dirId}:${on}`)
      scan = async () => ({ added: 0, updated: 0, removed: 0, errors: 0 })
      cancel = () => {}
      progress = undefined
    }
    await admin.plugin(ScannerStub)
    await tick()

    render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(screen.getByText('file:///music')).toBeTruthy()
    // The local row has no whole-source switch — its folders are the elements.
    expect(screen.queryByTestId('sources-list-toggle-local')).toBeNull()

    await act(async () => {
      screen.getByTestId('source-folder-toggle-dir-1').click()
      await tick()
    })
    await act(async () => {
      screen.getByTestId('source-folder-remove-dir-1').click()
      await tick()
    })
    expect(calls).toEqual(['enable:dir-1:false', 'remove:dir-1'])
  })
})
