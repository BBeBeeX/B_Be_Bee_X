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
import { Context, Service } from 'cordis'
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
import { SearchScreen, SourcesListScreen, TestScreen, inject } from './index.js'

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

  it('toggles a source off and on', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(EXAMPLE_DOC))
    await tick()
    const id = admin.sources.sources[0]!.id

    const { container } = render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    const toggle = container.querySelector(`[data-testid="sources-list-toggle-${id}"]`) as HTMLElement
    expect(toggle).toBeTruthy()
    await act(async () => {
      toggle.click()
      await tick()
    })
    expect(ctx.sources.source(id)?.enabled).toBe(false)
  })

  it('deletes a source only after the confirmation is pressed', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(EXAMPLE_DOC))
    await tick()
    const id = admin.sources.sources[0]!.id

    const { container } = render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      ;(container.querySelector(`[data-testid="sources-list-delete-${id}"]`) as HTMLElement).click()
      await tick()
    })
    expect(ctx.sources.source(id), 'the first press only asks').toBeTruthy()

    await act(async () => {
      ;(container.querySelector(`[data-testid="sources-list-delete-confirm-${id}"]`) as HTMLElement).click()
      await tick()
      await tick()
    })
    expect(ctx.sources.source(id)).toBeUndefined()
  })

  it('shows the local source its folders, with folder controls', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(EXAMPLE_DOC))
    await admin.db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES ('local', 'bbebee://local/local', 'This device', '{}', 'h', 0, 0)`,
    )
    await admin.sources.setEnabled('local', true)

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
      removeSpecifiedDir = async () => {}
      setEnabled = async () => {}
      scan = async () => ({ added: 0, updated: 0, removed: 0, errors: 0 })
      cancel = () => {}
      progress = undefined
    }
    await admin.plugin(ScannerStub)
    await tick()

    const { container } = render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('file:///music')
    expect(
      container.querySelector('[data-testid="source-folder-toggle-dir-1"]'),
    ).toBeTruthy()
    expect(
      container.querySelector('[data-testid="sources-list-toggle-local"]'),
      'the local row has no whole-source switch',
    ).toBeNull()
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
      recommend: false,
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
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
    const { container } = render(h(SearchScreen, { ctx }))
    await act(async () => {
      await tick()
    })
    expect(container.querySelector('[data-testid="search-input"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="search-submit"]')).toBeTruthy()
    expect(
      container.querySelector(`[data-testid="search-source-${admin.sources.sources[0]!.id}-track"]`),
    ).toBeTruthy()
    // Nothing asked yet: no results section, not an empty one.
    expect(container.textContent).not.toContain('Nothing found')
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
      ;(container.querySelector(`[data-testid="search-source-${alpha!.id}-track"]`) as HTMLElement).click()
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
