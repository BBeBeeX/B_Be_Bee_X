// @vitest-environment jsdom
/**
 * The mobile library screen, rendered.
 *
 * ⚠️ **This package had no tests, and that is how the device run went wrong.**
 * Its desktop twin was covered, and the two were assumed to behave the same
 * because they are written from the same hooks — but the shared assumption
 * they both broke was about the *context*, not about either screen.
 *
 * Two things are pinned here, and both are about the context a view is handed:
 *
 *  - It is **scoped**, not root. `new Context()` answers `undefined` for a
 *    service nobody registered; a plugin-scoped context *throws* for anything
 *    not injected. Every view test in this repo used the root kind, so
 *    `ctx.player?.playNow()` read as a safe optional in CI and threw on a
 *    phone the moment anyone tapped a track.
 *  - A context is not a React node. Handing one to React makes React read
 *    `$$typeof` on it, and on a scoped context that read throws too — which
 *    is what `[Error: cannot get property "$$typeof" without inject]` was.
 *
 * React Native is injected here as DOM host components, which is the same seam
 * `apps/mobile` uses to hand over the real `react-native`.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import sourcesPlugin from '@BBeBee/plugin-sources'
import type {
  Capabilities,
  MediaProvider,
  SearchQuery,
  SearchResult,
  Track,
} from '@BBeBee/protocol'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import httpPlugin from '@BBeBee/core-http-node'
import sourceRuntime from '@BBeBee/plugin-source-runtime'
import { LibraryScreen, SearchScreen, SourcesListScreen, TestScreen, inject } from './index.js'

afterEach(cleanup)

/** A fake native host: a `div` that keeps the RN props it was given. */
function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (onPress as () => void) : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  // FlashList takes `data`/`renderItem`, not children, so it needs its own.
  FlashList: function FlashList(props: {
    data?: readonly unknown[]
    renderItem?: (info: { item: unknown; index: number }) => ReactNode
    ListEmptyComponent?: ReactNode
    accessibilityLabel?: string
  }) {
    const items = props.data ?? []
    return h(
      'div',
      { 'data-host': 'FlashList', 'data-label': props.accessibilityLabel, role: 'list' },
      items.length === 0
        ? (props.ListEmptyComponent as ReactNode)
        : items.map((item, index) =>
            h('div', { key: index, role: 'listitem' }, props.renderItem?.({ item, index })),
          ),
    )
  },
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

/** The scoped context a shell hands a view, plus the root for fixtures. */
async function harness(): Promise<{ ctx: Context; admin: Context }> {
  const root = new Context()
  await root.plugin(PathsNode, { root: await tempDir('bbebee-mobile-screens') })
  await root.plugin(FsNode)
  await root.plugin(DbNode, { fileName: ':memory:' })
  await root.plugin(sourcesPlugin, {})
  await tick()

  /*
   * Scoped to **this package's own `inject`**, minus `ui`. Derived rather than
   * written out, so a screen that starts reading an undeclared service throws
   * here exactly as it would in the app.
   */
  const declared = inject.filter((name) => name !== 'ui')
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('mobile screens harness: no scoped context')
  return { ctx: scoped, admin: root }
}

/**
 * The same, plus the source runtime — without it `ctx.sources.debug` reports
 * "no source" rather than running anything. This build has no sandbox, which
 * is exactly the mobile situation the test screen has to degrade on.
 */
async function harnessWithRuntime(): Promise<{ ctx: Context; admin: Context }> {
  const { ctx, admin } = await harness()
  await admin.plugin(httpPlugin, {})
  await admin.plugin(sourceRuntime, {})
  await tick()
  await tick()
  return { ctx, admin }
}

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

/** Uncaught errors during `body` — React reports handler throws, not rethrows. */
async function reportedDuring(body: () => Promise<void> | void): Promise<string[]> {
  const seen: string[] = []
  const onError = (event: ErrorEvent) => {
    seen.push(String(event.error ?? event.message))
    event.preventDefault()
  }
  window.addEventListener('error', onError)
  try {
    await body()
  } finally {
    window.removeEventListener('error', onError)
  }
  return seen
}

describe('LibraryScreen on mobile', () => {
  it('renders the catalogue it was given', async () => {
    const { ctx, admin } = await harness()
    await withTrack(admin)

    const { container } = render(h(LibraryScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Jóga')
  })

  it('plays a track without a player loaded, instead of reporting an error', async () => {
    // The device bug: `ctx.player?.playNow()` is not a safe optional on a
    // scoped context, because the `?.` never gets to short-circuit — the
    // property read itself throws.
    const { ctx, admin } = await harness()
    await withTrack(admin)

    const { container } = render(h(LibraryScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    const row = container.querySelector('[role="listitem"] [data-host]') as HTMLElement | null
    expect(row, 'the track is on screen').toBeTruthy()

    const reported = await reportedDuring(() => {
      row!.click()
    })
    expect(reported, 'tapping with no player must be a no-op').toEqual([])
  })

  it('renders an empty library as an empty state, not a blank screen', async () => {
    const { ctx } = await harness()
    const { container } = render(h(LibraryScreen, { ctx }))
    await act(async () => {
      await tick()
    })
    expect(container.textContent).toContain('No music yet')
  })

  it('switches between all, local, and favorites scopes', async () => {
    const { ctx, admin } = await harness()
    await withTrack(admin)

    const { container } = render(h(LibraryScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Jóga')

    const favoritesBtn = Array.from(container.querySelectorAll('[data-host]')).find(
      (el) => el.textContent === 'Favorites',
    ) as HTMLElement | undefined
    expect(favoritesBtn).toBeTruthy()

    await act(async () => {
      favoritesBtn!.click()
      await tick()
    })

    expect(container.textContent).toContain('No favorites yet')
  })
})

/* ── the source list and the test screen ────────────────────────────────── */

const EXAMPLE_DOC = {
  sourceUrl: 'https://music.example.org',
  sourceName: 'Example',
  ruleStream: { url: '={{source.url}}/stream' },
}

describe('SourcesListScreen on mobile', () => {
  it('lists the imported sources', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(EXAMPLE_DOC))
    await tick()

    const { container } = render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Example')
    expect(container.textContent).toContain('https://music.example.org')
    expect(container.textContent).toContain('Test')
  })

  it('renders an empty list as an empty state, not a blank screen', async () => {
    const { ctx } = await harness()
    const { container } = render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })
    expect(container.textContent).toContain('No sources yet')
  })
})

describe('TestScreen on mobile', () => {
  it('shows both probes and streams the script step into the trace', async () => {
    const { ctx, admin } = await harnessWithRuntime()
    await admin.sources.import(JSON.stringify(EXAMPLE_DOC))
    await tick()
    const sourceId = admin.sources.sources[0]!.id

    const { container } = render(h(TestScreen, { ctx, sourceId }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('HTTP request')
    expect(container.textContent).toContain('Script')

    // This build has no sandbox — the honest mobile situation today — so
    // running the script reports that inline rather than failing silently.
    const run = container.querySelector('[data-testid="test-run-js"]') as HTMLElement
    expect(run, 'the run button is on screen').toBeTruthy()
    await act(async () => {
      run.click()
      await tick()
      await tick()
    })
    expect(container.textContent).toContain('no JavaScript sandbox')
  })
})

describe('SearchScreen on mobile', () => {
  const track = (sourceId: string, id: string, title: string): Track => ({
    urn: `BBeBee:${sourceId}:track:${id}`,
    title,
    artists: [
      { urn: `BBeBee:${sourceId}:artist:${id}`, name: 'Someone', role: 'main', ordinal: 0 },
    ],
  })

  function searchingProvider(
    sourceId: string,
    search: (query: SearchQuery) => Promise<SearchResult>,
  ): MediaProvider {
    const capabilities: Capabilities = {
      search: { tracks: true, albums: false, artists: false, playlists: false, fullText: false },
      browse: false,
      lyrics: false,
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
        return { kind: 'remote', target: 'https://a.example/s', seekable: true } as never
      },
      ping: async () => true,
      search,
    }
  }

  const DOCS = [
    { sourceUrl: 'https://alpha.example', sourceName: 'Alpha', ruleStream: { url: '={{source.url}}/s' } },
    { sourceUrl: 'https://beta.example', sourceName: 'Beta', ruleStream: { url: '={{source.url}}/s' } },
  ]

  it('shows the box and the source toggles before a search', async () => {
    const { ctx } = await harness()
    const { container } = render(h(SearchScreen, { ctx }))
    await act(async () => {
      await tick()
    })
    expect(container.textContent).toContain('Choose which sources to search')
    expect(container.querySelector('[data-testid="search-input"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="search-submit"]')).toBeTruthy()
  })

  it('lists each source’s hits under its own heading', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
    const [alpha, beta] = admin.sources.sources
    admin.sources.register(
      searchingProvider(alpha!.id, async () => ({
        tracks: { items: [track(alpha!.id, '1', 'Alpha Song')], hasMore: false },
      })),
    )
    admin.sources.register(
      searchingProvider(beta!.id, async () => ({
        tracks: { items: [track(beta!.id, '1', 'Beta Song')], hasMore: false },
      })),
    )
    await tick()

    const { container } = render(h(SearchScreen, { ctx, query: 'song' }))
    await act(async () => {
      ;(container.querySelector('[data-testid="search-submit"]') as HTMLElement).click()
      await tick()
      await tick()
    })

    expect(container.textContent).toContain('Alpha')
    expect(container.textContent).toContain('Beta')
    expect(container.textContent).toContain('Alpha Song')
    expect(container.textContent).toContain('Beta Song')
    expect(container.textContent).toContain('1 track')
  })

  it('reports a failing source instead of dropping it', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
    const [alpha, beta] = admin.sources.sources
    admin.sources.register(
      searchingProvider(alpha!.id, async () => {
        throw new Error('Alpha is down')
      }),
    )
    admin.sources.register(
      searchingProvider(beta!.id, async () => ({
        tracks: { items: [track(beta!.id, '1', 'Beta Song')], hasMore: false },
      })),
    )
    await tick()

    const { container } = render(h(SearchScreen, { ctx, query: 'song' }))
    await act(async () => {
      ;(container.querySelector('[data-testid="search-submit"]') as HTMLElement).click()
      await tick()
      await tick()
    })

    expect(container.textContent).toContain('Alpha is down')
    expect(container.textContent).toContain('Beta Song')
  })

  it('only asks the sources left toggled on', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
    const [alpha, beta] = admin.sources.sources
    admin.sources.register(
      searchingProvider(alpha!.id, async () => ({
        tracks: { items: [track(alpha!.id, '1', 'Alpha Song')], hasMore: false },
      })),
    )
    admin.sources.register(
      searchingProvider(beta!.id, async () => ({
        tracks: { items: [track(beta!.id, '1', 'Beta Song')], hasMore: false },
      })),
    )
    await tick()

    const { container } = render(h(SearchScreen, { ctx, query: 'song' }))
    await act(async () => {
      ;(container.querySelector(`[data-testid="search-source-${alpha!.id}"]`) as HTMLElement).click()
    })
    await act(async () => {
      ;(container.querySelector('[data-testid="search-submit"]') as HTMLElement).click()
      await tick()
      await tick()
    })

    expect(container.textContent).toContain('Beta Song')
    expect(container.textContent).not.toContain('Alpha Song')
  })
})
