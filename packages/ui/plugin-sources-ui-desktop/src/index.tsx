/**
 * React DOM views for `plugin-sources`.
 *
 * Library and album detail. Every value comes from a hook in the headless
 * package — `useTracks`, `useAlbums`, `useAlbum` — and this file is layout,
 * gestures and event wiring only (docs/08 1).
 *
 * The one thing worth doing carefully here is the *three* states a catalogue
 * read has. A screen that treats loading, empty and failed the same shows a
 * blank pane and tells the user nothing about which one they are looking at.
 */

import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Album, CatalogQuery, ImportReport, PlayerService, StreamQuality, Track, TraceEvent, UiService } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import {
  useAlbum,
  useAlbums,
  useSetLoved,
  useSourceImport,
  useSourceTrace,
  useSources,
  useTracks,
} from '@BBeBee/plugin-sources/hooks'
import {
  Artwork,
  Button,
  EmptyState,
  JsonTree,
  List,
  Text,
  TextField,
  TrackRow,
} from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/** What a screen shows while it does not yet have an answer. */
function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

/**
 * A failed read, said out loud.
 *
 * Never silently empty: "your library is empty" and "the catalogue could not
 * be read" look identical to a user, and only one of them is their problem.
 */
function Failed({ error, onRetry }: { error: Error; onRetry: () => void }): ReactElement {
  return h(EmptyState, {
    icon: '⚠',
    title: 'Could not read the library',
    description: error.message,
    action: h(Button, { onPress: onRetry, variant: 'secondary', children: 'Try again' }),
  })
}

const SCOPES = [
  { id: 'all', label: 'All' },
  { id: 'local', label: 'Local' },
  { id: 'favorites', label: 'Favorites' },
] as const

export type LibraryScope = (typeof SCOPES)[number]['id']

export function LibraryScreen({
  ctx,
  onOpenAlbum,
}: {
  ctx: Context
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const [scope, setScope] = useState<LibraryScope>('all')
  const [tab, setTab] = useState<'tracks' | 'albums'>('tracks')
  const setLoved = useSetLoved(ctx)

  const query = useMemo<CatalogQuery>(() => {
    const base: CatalogQuery = { sort: 'title' }
    if (scope === 'local') {
      return { ...base, sourceIds: ['local'] }
    }
    if (scope === 'favorites') {
      return { ...base, onlyLoved: true }
    }
    return base
  }, [scope])

  const tracks = useTracks(ctx, query)
  const albums = useAlbums(ctx, query)
  const active = tab === 'tracks' ? tracks : albums

  const handleOpenAlbum = (urn: string) => {
    onOpenAlbum?.(urn)
    serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.album, { urn })
  }

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: tokens.space[3],
          padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        },
      },
      h(
        'div',
        {
          role: 'tablist',
          'aria-label': 'Library Scope',
          style: { display: 'flex', gap: tokens.space[2] },
        },
        SCOPES.map(({ id, label }) =>
          h(Button, {
            key: id,
            variant: scope === id ? 'primary' : 'ghost',
            onPress: () => setScope(id),
            accessibilityLabel: `Show ${label}`,
            children: label,
          }),
        ),
      ),
      h(
        'div',
        {
          role: 'tablist',
          'aria-label': 'Library View',
          style: { display: 'flex', gap: tokens.space[2] },
        },
        (['tracks', 'albums'] as const).map((id) =>
          h(Button, {
            key: id,
            variant: tab === id ? 'secondary' : 'ghost',
            onPress: () => setTab(id),
            accessibilityLabel: `Show ${id}`,
            children: id === 'tracks' ? 'Tracks' : 'Albums',
          }),
        ),
      ),
    ),
    active.status === 'error' && active.error
      ? h(Failed, { error: active.error, onRetry: active.reload })
      : active.status === 'loading' && active.items.length === 0
        ? h(Pending, { label: 'Loading your library…' })
        : tab === 'tracks'
          ? h(TrackList, {
              ctx,
              tracks: tracks.items,
              scope,
              onToggleLoved: (urn, loved) => void setLoved(urn, loved),
              onEndReached: tracks.loadMore,
            })
          : h(AlbumGrid, {
              albums: albums.items,
              scope,
              onOpenAlbum: handleOpenAlbum,
              onEndReached: albums.loadMore,
            }),
  )
}

function TrackList({
  ctx,
  tracks,
  scope,
  onToggleLoved,
  onEndReached,
}: {
  ctx: Context
  tracks: readonly Track[]
  scope: LibraryScope
  onToggleLoved: (urn: string, loved: boolean) => void
  onEndReached: () => void
}): ReactElement {
  const empty =
    scope === 'favorites'
      ? h(EmptyState, {
          icon: '♥',
          title: 'No favorites yet',
          description: 'Click the heart icon on any track to add it to your favorites.',
        })
      : scope === 'local'
        ? h(EmptyState, {
            icon: '📁',
            title: 'No local music',
            description: 'Add a folder in Settings and it will appear here as it is scanned.',
          })
        : h(EmptyState, {
            icon: '📁',
            title: 'No music yet',
            description: 'Add a folder in Settings and it will appear here as it is scanned.',
          })

  return h(List<Track>, {
    items: tracks,
    accessibilityLabel: 'Tracks',
    estimatedItemSize: tokens.size.row,
    keyExtractor: (track) => track.urn,
    onEndReached,
    empty,
    renderItem: (track) =>
      h(TrackRow, {
        track,
        showAlbum: true,
        // Playing one track queues just that track; queueing the whole list
        // is a decision for the album screen, where "the rest" has a meaning.
        onPress: () => {
          void serviceOf<PlayerService>(ctx, 'player')?.playNow([track.urn])
          serviceOf<UiService>(ctx, 'ui')?.navigate('player.now-playing')
        },
        onToggleLoved: () => onToggleLoved(track.urn, !track.loved),
      }),
  })
}

function AlbumGrid({
  albums,
  scope,
  onOpenAlbum,
  onEndReached,
}: {
  albums: readonly Album[]
  scope: LibraryScope
  onOpenAlbum?: (urn: string) => void
  onEndReached: () => void
}): ReactElement {
  const empty =
    scope === 'favorites'
      ? h(EmptyState, { icon: '♥', title: 'No favorite albums yet' })
      : scope === 'local'
        ? h(EmptyState, { icon: '💿', title: 'No local albums' })
        : h(EmptyState, { icon: '💿', title: 'No albums yet' })

  return h(List<Album>, {
    items: albums,
    accessibilityLabel: 'Albums',
    estimatedItemSize: 220,
    keyExtractor: (album) => album.urn,
    onEndReached,
    empty,
    renderItem: (album) =>
      h(
        'button',
        {
          type: 'button',
          onClick: () => onOpenAlbum?.(album.urn),
          'aria-label': album.title,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[3],
            width: '100%',
            padding: tokens.space[2],
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: p().text.primary,
          },
        },
        h(Artwork, { artwork: album.artwork, seed: album.urn, size: tokens.size.artworkThumb }),
        h(
          'span',
          { style: { textAlign: 'left', minWidth: 0 } },
          h(Text, { numberOfLines: 1, children: album.title }),
          album.year
            ? h(Text, { variant: 'sm', tone: 'muted', children: String(album.year) })
            : null,
        ),
      ),
  })
}

export function AlbumScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const album = useAlbum(ctx, urn)

  if (album.status === 'loading' || album.status === 'idle') {
    return h(Pending, { label: 'Loading album…' })
  }
  if (album.status === 'error' || !album.data) {
    return h(EmptyState, {
      icon: '⚠',
      title: 'Album unavailable',
      description: album.error?.message,
    })
  }

  const detail = album.data
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h(
      'header',
      {
        style: {
          display: 'flex',
          gap: tokens.space[4],
          padding: tokens.space[4],
          alignItems: 'flex-end',
        },
      },
      h(Artwork, { artwork: detail.artwork, seed: detail.urn, size: 160, radius: tokens.radius.md }),
      h(
        'div',
        null,
        h(Text, { variant: 'xl', children: detail.title }),
        h(Text, {
          tone: 'muted',
          children: detail.artists?.map((a) => a.name).join(', ') ?? '',
        }),
        h(Button, {
          onPress: () => {
            void serviceOf<PlayerService>(ctx, 'player')?.playNow(detail.tracks.map((t) => t.urn))
            serviceOf<UiService>(ctx, 'ui')?.navigate('player.now-playing')
          },
          children: 'Play album',
          // Disabled rather than absent: an album with no playable tracks is
          // a real state, and hiding the control hides the reason.
          disabled: detail.tracks.length === 0,
        }),
      ),
    ),
    h(List<Track>, {
      items: detail.tracks,
      accessibilityLabel: `Tracks on ${detail.title}`,
      estimatedItemSize: tokens.size.row,
      keyExtractor: (track) => track.urn,
      empty: h(EmptyState, { title: 'This album has no tracks' }),
      renderItem: (track, index) =>
        h(TrackRow, {
          track,
          showArtwork: false,
          // Playing from an album plays the album from that point, which is
          // what "play this track" means in an album context.
          onPress: () => {
            void serviceOf<PlayerService>(ctx, 'player')?.playNow(
              detail.tracks.map((t) => t.urn),
              { startIndex: index },
            )
            serviceOf<UiService>(ctx, 'ui')?.navigate('player.now-playing')
          },
        }),
    }),
  )
}


/* ── importing ──────────────────────────────────────────────────────────── */

/**
 * Paste a source string.
 *
 * The preview is the screen's reason for existing. A set pasted from a forum
 * is opaque — the user cannot read JSON at a glance, and an import that
 * silently adds eleven sources is one they cannot undo without knowing which
 * eleven. So what *would* be imported is named before the button is pressed.
 */
export function ImportScreen({ ctx }: { ctx: Context }): ReactElement {
  const state = useSourceImport(ctx)
  const scheme = p()

  return h(
    'section',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Import a source'),
    h(
      Text,
      { variant: 'sm', tone: 'muted' },
      'Paste a source string — one document or a whole set. Nothing is written until you import.',
    ),
    h(TextField, {
      value: state.text,
      onChange: state.setText,
      multiline: true,
      rows: 14,
      placeholder: '{ "sourceUrl": "https://…", "sourceName": "…", "ruleStream": { … } }',
      accessibilityLabel: 'Source string',
      testID: 'source-import-input',
      ...(state.issues.length > 0
        ? { error: state.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n') }
        : {}),
    }),
    state.preview
      ? h(
          'ul',
          {
            style: {
              margin: 0,
              padding: tokens.space[3],
              borderRadius: tokens.radius.sm,
              background: scheme.bg.raised,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[1],
            },
            'aria-label': 'What will be imported',
          },
          h(
            Text,
            { variant: 'sm', tone: 'muted' },
            `${state.preview.count} source${state.preview.count === 1 ? '' : 's'} in this string`,
          ),
          ...state.preview.names.map((name) => h('li', { key: name }, h(Text, { variant: 'sm' }, name))),
        )
      : null,
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2] } },
      h(Button, {
        onPress: state.submit,
        disabled: state.busy || !state.preview,
        loading: state.busy,
        testID: 'source-import-submit',
        children: 'Import',
      }),
      h(Button, {
        variant: 'ghost',
        onPress: state.reset,
        disabled: state.busy,
        children: 'Clear',
      }),
    ),
    state.report
      ? h(
          Text,
          { variant: 'sm', tone: state.report.added.length + state.report.updated.length > 0 ? 'accent' : 'muted' },
          summariseImport(state.report),
        )
      : null,
  )
}

/** What an import did, in a sentence. */
function summariseImport(report: ImportReport): string {
  const parts: string[] = []
  if (report.added.length) parts.push(`${report.added.length} added`)
  if (report.updated.length) parts.push(`${report.updated.length} updated`)
  if (report.unchanged.length) parts.push(`${report.unchanged.length} unchanged`)
  if (report.rejected.length) parts.push(`${report.rejected.length} rejected`)
  // Never an empty string: "nothing happened" reads as a button that did not
  // work, which is the one thing it must not look like.
  return parts.length > 0 ? parts.join(', ') : 'nothing to import'
}

/** The trace, as lines. Every step, including the ones that worked. */
function TraceList({
  events,
  running,
}: {
  events: readonly TraceEvent[]
  running: boolean
}): ReactElement {
  const scheme = p()
  if (events.length === 0) {
    return h(EmptyState, {
      title: running ? 'Running…' : 'No trace yet',
      description: running ? undefined : 'Run a step to see what the source did.',
    })
  }
  return h(
    'ol',
    {
      'aria-label': 'Trace',
      'aria-live': 'polite',
      style: {
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[1],
        fontFamily: tokens.font.family.mono,
        fontSize: tokens.font.size.sm,
      },
    },
    ...events.map((event, i) =>
      h(
        'li',
        {
          key: i,
          style: {
            padding: tokens.space[2],
            borderRadius: tokens.radius.sm,
            background: scheme.bg.raised,
            borderLeft: `3px solid ${event.kind === 'error' ? scheme.state.error : scheme.border.subtle}`,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            // A whole value — a body, an output — is what the test screen
            // exists to show, but it must not stretch the page to the height
            // of the body it is showing.
            ...(event.kind === 'value'
              ? { maxHeight: 480, overflow: 'auto', background: scheme.bg.overlay }
              : {}),
          },
        },
        event.kind === 'value' ? valueBlock(event) : traceLine(event),
      ),
    ),
  )
}

/** One event as text. Redacted upstream; this only lays it out. */
function traceLine(event: TraceEvent): string {
  switch (event.kind) {
    case 'http':
      // Status 0 means the request never came back — which is the diagnosis,
      // so it is spelled out rather than shown as a zero.
      return `${event.method} ${event.url} → ${event.status === 0 ? 'no response' : event.status} (${event.ms}ms)`
    case 'error':
      return `✗ ${event.block ? `${event.block}.${event.field ?? ''} ` : ''}${event.message}`
    case 'result':
      return `✓ ${event.summary}`
    case 'log':
      return `· ${event.message}`
    // Value events render through `valueBlock`, never as a line; this branch
    // exists so the switch stays total if a kind is ever added.
    default:
      return ''
  }
}

/**
 * A parsed JSON value as a tree — the shape readable at a glance, expandable
 * where the reader wants to look. Unparseable text (an HTML page, a bare URL)
 * stays exactly as it arrived.
 */
function valueBlock(event: Extract<TraceEvent, { kind: 'value' }>): ReactElement {
  const text = event.value
  const parseable = text.trim().startsWith('{') || text.trim().startsWith('[')
  let parsed: unknown
  if (parseable) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // Not JSON after all — the raw text is the honest answer.
    }
  }
  return h(
    'div',
    null,
    h('div', { style: { color: p().text.secondary, marginBottom: tokens.space[1] } }, event.label),
    parsed !== undefined
      ? h(JsonTree, { value: parsed, accessibilityLabel: event.label })
      : text,
  )
}

/* ── the source list ───────────────────────────────────────────────────── */

/**
 * The imported sources — the hub everything else hangs off.
 *
 * Until this screen existed, "Music sources" was a settings contribution with
 * no view: the Shell filters settings pages by whether a view is registered,
 * so the entry was invisible and Import, Diagnose and Test were reachable by
 * nothing but a `ui/navigate` call. Every navigation here is one button.
 */
export function SourcesListScreen({ ctx }: { ctx: Context }): ReactElement {
  const scheme = p()
  const sources = useSources(ctx)

  return h(
    'section',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Music sources'),
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2] } },
      h(Button, {
        onPress: () => serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.sourceImport),
        testID: 'sources-list-import',
        children: 'Import a source',
      }),
    ),
    sources.length === 0
      ? h(EmptyState, {
          title: 'No sources yet',
          description: 'Import a source string to add a music backend.',
        })
      : h(
          'ul',
          {
            'aria-label': 'Imported sources',
            style: {
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[2],
            },
          },
          ...sources.map((source) =>
            h(
              'li',
              {
                key: source.id,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: tokens.space[3],
                  padding: tokens.space[3],
                  borderRadius: tokens.radius.sm,
                  background: scheme.bg.raised,
                },
              },
              h(
                'div',
                { style: { minWidth: 0 } },
                h(Text, { variant: 'md' }, source.name),
                h(Text, { variant: 'sm', tone: 'muted' }, source.sourceUrl),
                ...(!source.enabled
                  ? [h(Text, { variant: 'sm', tone: 'muted' }, 'disabled')]
                  : source.lastError
                    ? [h(Text, { variant: 'sm', tone: 'muted' }, source.lastError)]
                    : []),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: tokens.space[2], flexShrink: 0 } },
                h(Button, {
                  variant: 'secondary',
                  onPress: () => serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.sourceTest, { sourceId: source.id }),
                  testID: `sources-list-test-${source.id}`,
                  children: 'Test',
                }),
              ),
            ),
          ),
        ),
  )
}

export const name = 'plugin-sources-ui-desktop'
/**
 * Bind a screen to *this* plugin's context, not the shell's.
 *
 * ⚠️ The shell renders a view as `h(Component, { ctx })` with **its own**
 * context — the one it got from `app.ready(['ui'])`, which has `ui` injected
 * and nothing else. A cordis context throws for any property that was not
 * injected, so a screen reading `ctx.sources` through its hooks threw
 * `cannot get property "sources" without inject` on a device while every
 * test passed, because tests built a root context where that read answers
 * `undefined` instead.
 *
 * Registering a closure over the context this plugin was applied with is the
 * fix, and it is what every view package here does: the screen runs on a
 * context with exactly what this package's `inject` declares. The shell's
 * props are still forwarded, so a view that takes more than `ctx` keeps
 * working.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  // `h(Screen, …)`, not `Screen(…)`: calling a component as a function splices
  // its hooks into this one's list, which works right up until someone renders
  // it conditionally. An element keeps them separate.
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

/* ── testing a source, feature by feature ──────────────────────────────── */

/** What one select option needs: the id, and a name to show. */
interface SourceOption {
  id: string
  name: string
}

/** A page number typed by the user, or undefined when the box is empty. */
function pageOf(text: string): number | undefined {
  const n = parseInt(text, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * One source, exercised feature by feature.
 *
 * The selector picks which imported source everything below tests. Each test
 * area corresponds to one `MediaProvider` operation and appears only when
 * that source implements it — the list of areas *is* the list of features.
 * Every run streams into the trace below: each HTTP request the feature made
 * (method, URL, status, duration), each `src.log` line the document printed,
 * a one-line outcome, and the feature's whole output as a value block. Two
 * areas are always there and belong to no document: a raw HTTP request
 * through the source's own client, and arbitrary script in its sandbox.
 */
export function TestScreen({ ctx, sourceId }: { ctx: Context; sourceId?: string }): ReactElement {
  const scheme = p()
  const sources = useSources(ctx)
  const [selectedId, setSelectedId] = useState<string | undefined>(sourceId ?? sources[0]?.id)
  const trace = useSourceTrace(ctx, selectedId)

  // A source imported after mount, or navigation carrying an initial id.
  // Neither overrides a selection the user already made: the adjustment fires
  // only while nothing is selected, and the effect only on a new prop.
  if (selectedId === undefined && sources.length > 0) setSelectedId(sources[0]!.id)
  useEffect(() => {
    if (sourceId) setSelectedId(sourceId)
  }, [sourceId])

  const options: readonly SourceOption[] = sources.map((s) => ({ id: s.id, name: s.name }))
  const provider = selectedId
    ? ctx.sources.providers.find((p) => p.sourceId === selectedId)
    : undefined

  // Per-area parameters. One object per feature keeps them independent, so a
  // keyword typed for search survives a stream id being typed elsewhere.
  const [searchText, setSearchText] = useState('test')
  const [searchPage, setSearchPage] = useState('')
  const [browseNode, setBrowseNode] = useState('')
  const [browsePage, setBrowsePage] = useState('')
  const [albumId, setAlbumId] = useState('')
  const [artistId, setArtistId] = useState('')
  const [playlistId, setPlaylistId] = useState('')
  const [playlistPage, setPlaylistPage] = useState('')
  const [lyricsId, setLyricsId] = useState('')
  const [libraryKind, setLibraryKind] = useState('playlist')
  const [libraryPage, setLibraryPage] = useState('')
  const [streamId, setStreamId] = useState('')
  const [quality, setQuality] = useState('normal')
  const [method, setMethod] = useState<'GET' | 'POST'>('GET')
  const [url, setUrl] = useState('')
  const [headersJson, setHeadersJson] = useState('')
  const [body, setBody] = useState('')
  const [code, setCode] = useState('return src.time.now()')
  const [argsJson, setArgsJson] = useState('{ "key": "test", "page": 1 }')
  const [requestError, setRequestError] = useState<string | undefined>(undefined)

  const runHttp = () => {
    setRequestError(undefined)
    let headers: Record<string, string> | undefined
    if (headersJson.trim()) {
      try {
        const parsed: unknown = JSON.parse(headersJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setRequestError('headers must be a JSON object')
          return
        }
        headers = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      } catch (error) {
        setRequestError(`headers are not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }
    trace.run({
      kind: 'http',
      method,
      url,
      ...(headers ? { headers } : {}),
      ...(method === 'POST' && body ? { body } : {}),
    })
  }

  const runJs = () => {
    setRequestError(undefined)
    trace.run({ kind: 'js', code, ...(argsJson.trim() ? { argsJson } : {}) })
  }

  if (sources.length === 0) {
    return h(
      'section',
      { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] } },
      h(Text, { variant: 'lg' }, 'Test a source'),
      h(EmptyState, {
        title: 'No sources yet',
        description: 'Import a source string first, then test it here.',
      }),
    )
  }

  /** One test area: a heading, the parameter fields, one run button. */
  const area = (
    title: string,
    testID: string,
    fields: ReactElement[],
    onRun: () => void,
    disabled: boolean,
  ): ReactElement =>
    h(
      'div',
      {
        key: title,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[2],
          padding: tokens.space[3],
          borderRadius: tokens.radius.sm,
          background: scheme.bg.raised,
        },
      },
      h(Text, { variant: 'md' }, title),
      ...fields,
      h(Button, {
        onPress: onRun,
        disabled: trace.running || disabled,
        loading: trace.running,
        testID,
        children: 'Run',
      }),
    )

  const field = (label: string, value: string, onChange: (next: string) => void, testID: string, placeholder?: string): ReactElement =>
    h(
      'label',
      { key: label, style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
      h(Text, { variant: 'sm', tone: 'muted' }, label),
      h(TextField, { value, onChange, testID, ...(placeholder ? { placeholder } : {}) }),
    )

  const qualities = provider?.capabilities.streaming.qualities ?? ['normal']

  // Two columns: what you run on the left, what came back on the right. Each
  // scrolls on its own, so a long output never pushes the controls away.
  return h(
    'section',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        gap: tokens.space[4],
        padding: tokens.space[4],
        height: '100%',
        minHeight: 0,
        alignItems: 'stretch',
      },
    },
    h(
      'div',
      {
        'aria-label': 'Test controls',
        style: {
          width: 440,
          flexShrink: 0,
          overflowY: 'auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[3],
        },
      },
      h(Text, { variant: 'lg' }, 'Test a source'),
    h(
      'label',
      { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
      h(Text, { variant: 'sm', tone: 'muted' }, 'Source'),
      h(
        'select',
        {
          value: selectedId ?? '',
          onChange: (event: Event & { target: HTMLSelectElement }) => {
            setSelectedId(event.target.value)
            trace.clear()
          },
          'aria-label': 'Source to test',
          testID: 'test-source-select',
          style: {
            padding: tokens.space[2],
            borderRadius: tokens.radius.sm,
            background: scheme.bg.raised,
            color: scheme.text.primary,
            border: 'none',
          },
        },
        ...options.map((option) =>
          h('option', { key: option.id, value: option.id }, option.name),
        ),
      ),
    ),

    !provider
      ? h(
          Text,
          { variant: 'sm', tone: 'muted' },
          'This source is not active right now — enable it in the source list to exercise its features.',
        )
      : null,
    provider && provider.capabilities.search.tracks
      ? area('Search', 'test-run-search', [
          field('Keyword', searchText, setSearchText, 'test-search-text'),
          field('Page', searchPage, setSearchPage, 'test-search-page', '1'),
        ], () => trace.run({ kind: 'search', text: searchText, ...(pageOf(searchPage) ? { page: pageOf(searchPage) } : {}) }), !searchText.trim())
      : null,
    provider && provider.capabilities.browse
      ? area('Browse', 'test-run-browse', [
          field('Node id (empty for the root)', browseNode, setBrowseNode, 'test-browse-node'),
          field('Page', browsePage, setBrowsePage, 'test-browse-page', '1'),
        ], () => trace.run({ kind: 'browse', ...(browseNode.trim() ? { nodeId: browseNode.trim() } : {}), ...(pageOf(browsePage) ? { page: pageOf(browsePage) } : {}) }), false)
      : null,
    provider && typeof provider.getAlbum === 'function'
      ? area('Album', 'test-run-album', [
          field('Album id', albumId, setAlbumId, 'test-album-id'),
        ], () => trace.run({ kind: 'album', id: albumId.trim() }), !albumId.trim())
      : null,
    provider && typeof provider.getArtist === 'function'
      ? area('Artist', 'test-run-artist', [
          field('Artist id', artistId, setArtistId, 'test-artist-id'),
        ], () => trace.run({ kind: 'artist', id: artistId.trim() }), !artistId.trim())
      : null,
    provider && typeof provider.getPlaylist === 'function'
      ? area('Playlist', 'test-run-playlist', [
          field('Playlist id', playlistId, setPlaylistId, 'test-playlist-id'),
          field('Page', playlistPage, setPlaylistPage, 'test-playlist-page', '1'),
        ], () => trace.run({ kind: 'playlist', id: playlistId.trim(), ...(pageOf(playlistPage) ? { page: pageOf(playlistPage) } : {}) }), !playlistId.trim())
      : null,
    provider && typeof provider.getLyrics === 'function'
      ? area('Lyrics', 'test-run-lyrics', [
          field('Track id', lyricsId, setLyricsId, 'test-lyrics-id'),
        ], () => trace.run({ kind: 'lyrics', id: lyricsId.trim() }), !lyricsId.trim())
      : null,
    provider && provider.capabilities.library.read
      ? area('Library list', 'test-run-library', [
          field("Kind ('track', 'album', 'artist' or 'playlist')", libraryKind, setLibraryKind, 'test-library-kind'),
          field('Page', libraryPage, setLibraryPage, 'test-library-page', '1'),
        ], () => trace.run({ kind: 'library', list: (libraryKind.trim() || 'playlist') as 'playlist', ...(pageOf(libraryPage) ? { page: pageOf(libraryPage) } : {}) }), false)
      : null,
    provider
      ? area('Stream', 'test-run-stream', [
          field('Track id', streamId, setStreamId, 'test-stream-id'),
          field(`Quality (${qualities.join(', ')})`, quality, setQuality, 'test-stream-quality'),
        ], () => trace.run({ kind: 'stream', id: streamId.trim(), ...(quality ? { quality: quality as StreamQuality } : {}) }), !streamId.trim())
      : null,

    area('HTTP request — through this source\'s own client', 'test-run-http', [
      h(
        'div',
        { key: 'method', style: { display: 'flex', gap: tokens.space[2] } },
        h(Button, {
          variant: method === 'GET' ? 'secondary' : 'ghost',
          onPress: () => setMethod('GET'),
          testID: 'test-method-get',
          children: 'GET',
        }),
        h(Button, {
          variant: method === 'POST' ? 'secondary' : 'ghost',
          onPress: () => setMethod('POST'),
          testID: 'test-method-post',
          children: 'POST',
        }),
      ),
      field('URL', url, setUrl, 'test-url', 'https://…'),
      field('Headers (JSON, optional)', headersJson, setHeadersJson, 'test-headers', '{ "User-Agent": "…" }'),
      ...(method === 'POST' ? [field('Body', body, setBody, 'test-body')] : []),
    ], runHttp, !url.trim()),

    area('Script — the document\'s functions are in scope', 'test-run-js', [
      field('Code', code, setCode, 'test-code', "return getBiliArtist('9469745')"),
      field('Arguments (JSON — its keys become variables)', argsJson, setArgsJson, 'test-args', '{ "key": "test" }'),
    ], runJs, !code.trim()),

    requestError ? h(Text, { variant: 'sm', tone: 'muted' }, requestError) : null,
      ),
      h(
        'div',
        {
          'aria-label': 'Results',
          style: { flex: 1, minWidth: 0, overflowY: 'auto', minHeight: 0 },
        },
        h(TraceList, { events: trace.events, running: trace.running }),
      ),
  )
}

export const inject = ['ui', 'sources']

export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SOURCES_VIEWS.library, bound(ctx, LibraryScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.album, bound(ctx, AlbumScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceList, bound(ctx, SourcesListScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceImport, bound(ctx, ImportScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceTest, bound(ctx, TestScreen))
  }, 'sources-ui-desktop')
}

export default { name, inject, apply }
