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
import type { AlbumDetail, Capabilities, MediaProvider } from '@BBeBee/protocol'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { ImportScreen, LibraryScreen, TestScreen, inject } from './index.js'

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

  it('plays track and navigates to player.now-playing on click', async () => {
    const { admin } = await harness()
    await withTrack(admin)

    const calls: string[] = []
    class PlayerStub extends Service {
      constructor(c: Context) { super(c, 'player') }
      playNow = async (urns: string[]) => void calls.push(`play:${urns.join(',')}`)
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

      expect(calls).toContain('play:BBeBee:local:track:1')
      expect(calls).toContain('nav:player.now-playing')
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
