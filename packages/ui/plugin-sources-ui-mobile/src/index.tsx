/**
 * React Native views for `plugin-sources`.
 *
 * Same hooks, same view ids, same three-state handling as the desktop twin —
 * only the elements differ. A tab bar of two buttons rather than a tablist,
 * a single-column list rather than a grid, because a phone has one column.
 */

import { createElement as h, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Album, CatalogQuery, ImportReport, PlayerService, Track, TraceEvent, UiService } from '@BBeBee/protocol'
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
  nativePrimitives,
} from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

/** A failed read, said out loud — never a silently empty library. */
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
  const native = nativePrimitives()
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

  const trackEmpty =
    scope === 'favorites'
      ? h(EmptyState, {
          icon: '♥',
          title: 'No favorites yet',
          description: 'Tap the heart icon on any track to add it to your favorites.',
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

  const albumEmpty =
    scope === 'favorites'
      ? h(EmptyState, { icon: '♥', title: 'No favorite albums yet' })
      : scope === 'local'
        ? h(EmptyState, { icon: '💿', title: 'No local albums' })
        : h(EmptyState, { icon: '💿', title: 'No albums yet' })

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base } },
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: tokens.space[3],
          paddingVertical: tokens.space[2],
        },
      },
      h(
        native.View as never,
        {
          accessibilityRole: 'tablist',
          style: { flexDirection: 'row', gap: tokens.space[2] },
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
        native.View as never,
        {
          accessibilityRole: 'tablist',
          style: { flexDirection: 'row', gap: tokens.space[2] },
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
          ? h(List<Track>, {
              items: tracks.items,
              accessibilityLabel: 'Tracks',
              estimatedItemSize: tokens.size.row,
              keyExtractor: (track) => track.urn,
              onEndReached: tracks.loadMore,
              empty: trackEmpty,
              renderItem: (track) =>
                h(TrackRow, {
                  track,
                  showAlbum: true,
                  onPress: () => {
                    void serviceOf<PlayerService>(ctx, 'player')?.playNow([track.urn])
                    serviceOf<UiService>(ctx, 'ui')?.navigate('player.now-playing')
                  },
                  onToggleLoved: () => void setLoved(track.urn, !track.loved),
                }),
            })
          : h(List<Album>, {
              items: albums.items,
              accessibilityLabel: 'Albums',
              estimatedItemSize: tokens.size.row,
              keyExtractor: (album) => album.urn,
              onEndReached: albums.loadMore,
              empty: albumEmpty,
              renderItem: (album) =>
                h(
                  native.Pressable as never,
                  {
                    accessibilityRole: 'button',
                    accessibilityLabel: album.title,
                    onPress: () => handleOpenAlbum(album.urn),
                    style: {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: tokens.space[3],
                      padding: tokens.space[2],
                    },
                  },
                  h(Artwork, {
                    artwork: album.artwork,
                    seed: album.urn,
                    size: tokens.size.artworkThumb,
                  }),
                  h(
                    native.View as never,
                    { style: { flex: 1, minWidth: 0 } },
                    h(Text, { numberOfLines: 1, children: album.title }),
                    album.year
                      ? h(Text, { variant: 'sm', tone: 'muted', children: String(album.year) })
                      : null,
                  ),
                ),
            }),
  )
}

export function AlbumScreen({
  ctx,
  urn,
  onBack,
}: {
  ctx: Context
  urn?: string
  onBack?: () => void
}): ReactElement {
  const native = nativePrimitives()
  const album = useAlbum(ctx, urn)

  const handleBack = () => {
    if (onBack) onBack()
    else serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.library)
  }

  if (album.status === 'loading' || album.status === 'idle') {
    return h(Pending, { label: 'Loading album…' })
  }
  if (album.status === 'error' || !album.data) {
    return h(EmptyState, {
      icon: '⚠',
      title: 'Album unavailable',
      description: album.error?.message,
      action: h(Button, { onPress: handleBack, variant: 'secondary', children: 'Back to library' }),
    })
  }

  const detail = album.data
  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base } },
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: tokens.space[3],
          paddingVertical: tokens.space[2],
        },
      },
      h(
        native.Pressable as never,
        {
          accessibilityRole: 'button',
          accessibilityLabel: 'Back to library',
          onPress: handleBack,
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: tokens.space[1],
            paddingHorizontal: tokens.space[2],
          },
        },
        h(Text, { variant: 'sm', tone: 'accent', children: '‹ Library' }),
      ),
    ),
    h(
      native.View as never,
      { style: { alignItems: 'center', gap: tokens.space[2], padding: tokens.space[4] } },
      h(Artwork, { artwork: detail.artwork, seed: detail.urn, size: 200, radius: tokens.radius.md }),
      h(Text, { variant: 'xl', numberOfLines: 2, children: detail.title }),
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
        disabled: detail.tracks.length === 0,
      }),
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
          // Playing from an album plays the album from that point.
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
 * Same screen as desktop, same hook, different primitives — which is the whole
 * arrangement in docs/08 §1. The preview exists for the same reason too: a set
 * pasted from a forum is opaque, and an import that silently adds eleven
 * sources is one the user cannot undo without knowing which eleven.
 */
export function ImportScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const state = useSourceImport(ctx)
  const scheme = p()

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
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
      rows: 10,
      placeholder: '{ "sourceUrl": "https://…", "sourceName": "…" }',
      accessibilityLabel: 'Source string',
      testID: 'source-import-input',
      ...(state.issues.length > 0
        ? { error: state.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n') }
        : {}),
    }),
    state.preview
      ? h(
          native.View as never,
          {
            accessibilityLabel: 'What will be imported',
            style: {
              padding: tokens.space[3],
              borderRadius: tokens.radius.sm,
              backgroundColor: scheme.bg.raised,
              gap: tokens.space[1],
            },
          },
          h(
            Text,
            { variant: 'sm', tone: 'muted' },
            `${state.preview.count} source${state.preview.count === 1 ? '' : 's'} in this string`,
          ),
          ...state.preview.names.map((name) => h(Text, { key: name, variant: 'sm' }, name)),
        )
      : null,
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[2] } },
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
    state.report ? h(Text, { variant: 'sm', tone: 'muted' }, summariseImport(state.report)) : null,
  )
}

/** What an import did, in a sentence. Never empty — see the desktop twin. */
function summariseImport(report: ImportReport): string {
  const parts: string[] = []
  if (report.added.length) parts.push(`${report.added.length} added`)
  if (report.updated.length) parts.push(`${report.updated.length} updated`)
  if (report.unchanged.length) parts.push(`${report.unchanged.length} unchanged`)
  if (report.rejected.length) parts.push(`${report.rejected.length} rejected`)
  return parts.length > 0 ? parts.join(', ') : 'nothing to import'
}

/** Every step, including the ones that worked. See the desktop twin. */
function TraceList({
  events,
  running,
}: {
  events: readonly TraceEvent[]
  running: boolean
}): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  if (events.length === 0) {
    return h(EmptyState, {
      title: running ? 'Running…' : 'No trace yet',
      description: running ? undefined : 'Run a step to see what each rule receives and produces.',
    })
  }
  return h(
    native.View as never,
    { accessibilityLabel: 'Trace', style: { gap: tokens.space[1] } },
    ...events.map((event, i) =>
      h(
        native.View as never,
        {
          key: i,
          style: {
            padding: tokens.space[2],
            borderRadius: tokens.radius.sm,
            backgroundColor: event.kind === 'value' ? scheme.bg.overlay : scheme.bg.raised,
            borderLeftWidth: 3,
            borderLeftColor: event.kind === 'error' ? scheme.state.error : scheme.border.subtle,
            maxHeight: event.kind === 'value' ? 420 : undefined,
          },
        },
        event.kind === 'value' ? valueBlock(event) : h(Text, { variant: 'sm' }, traceLine(event)),
      ),
    ),
  )
}

/** One event as text. Redacted upstream; this only lays it out. */
function traceLine(event: TraceEvent): string {
  switch (event.kind) {
    case 'http':
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
  const native = nativePrimitives()
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
    native.View as never,
    null,
    h(Text, { variant: 'sm', tone: 'muted' }, event.label),
    parsed !== undefined
      ? h(JsonTree, { value: parsed, accessibilityLabel: event.label })
      : h(Text, { variant: 'sm' }, text),
  )
}

/* ── the source list ───────────────────────────────────────────────────── */

/**
 * The imported sources — the hub everything else hangs off. See the desktop
 * twin: until this screen existed the Import, Diagnose and Test screens were
 * registered but reachable by nothing.
 */
export function SourcesListScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  const sources = useSources(ctx)

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Music sources'),
    h(Button, {
      onPress: () => serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.sourceImport),
      testID: 'sources-list-import',
      children: 'Import a source',
    }),
    sources.length === 0
      ? h(EmptyState, {
          title: 'No sources yet',
          description: 'Import a source string to add a music backend.',
        })
      : h(
          native.View as never,
          { accessibilityLabel: 'Imported sources', style: { gap: tokens.space[2] } },
          ...sources.map((source) =>
            h(
              native.View as never,
              {
                key: source.id,
                style: {
                  padding: tokens.space[3],
                  borderRadius: tokens.radius.sm,
                  backgroundColor: scheme.bg.raised,
                  gap: tokens.space[1],
                },
              },
              h(Text, { variant: 'md' }, source.name),
              h(Text, { variant: 'sm', tone: 'muted' }, source.sourceUrl),
              h(
                native.View as never,
                { style: { flexDirection: 'row', gap: tokens.space[2] } },
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

/* ── testing a source, feature by feature ──────────────────────────────── */

/** A page number typed by the user, or undefined when the box is empty. */
function pageOf(text: string): number | undefined {
  const n = parseInt(text, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * One source, exercised feature by feature. See the desktop twin: the
 * selector picks the source under test, each implemented feature gets its own
 * test area, and every run streams HTTP lines, `src.log` lines and the whole
 * output into one trace. The dropdown is a button plus its option list —
 * React Native has no native select to borrow.
 */
export function TestScreen({ ctx, sourceId }: { ctx: Context; sourceId?: string }): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  const sources = useSources(ctx)
  const [selectedId, setSelectedId] = useState<string | undefined>(sourceId ?? sources[0]?.id)
  const trace = useSourceTrace(ctx, selectedId)
  const [pickerOpen, setPickerOpen] = useState(false)

  // A source imported after mount, or navigation carrying an initial id.
  // Neither overrides a selection the user already made.
  if (selectedId === undefined && sources.length > 0) setSelectedId(sources[0]!.id)

  const selected = sources.find((s) => s.id === selectedId)
  const provider = selectedId
    ? ctx.sources.providers.find((p) => p.sourceId === selectedId)
    : undefined

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
      native.View as never,
      { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
      h(Text, { variant: 'lg' }, 'Test a source'),
      h(EmptyState, {
        title: 'No sources yet',
        description: 'Import a source string first, then test it here.',
      }),
    )
  }

  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    testID: string,
    placeholder?: string,
  ): ReactElement =>
    h(
      native.View as never,
      { key: label, style: { gap: tokens.space[1] } },
      h(Text, { variant: 'sm', tone: 'muted' }, label),
      h(TextField, { value, onChange, testID, ...(placeholder ? { placeholder } : {}) }),
    )

  const area = (
    title: string,
    testID: string,
    fields: ReactElement[],
    onRun: () => void,
    disabled: boolean,
  ): ReactElement =>
    h(
      native.View as never,
      {
        key: title,
        style: {
          padding: tokens.space[3],
          borderRadius: tokens.radius.sm,
          backgroundColor: scheme.bg.raised,
          gap: tokens.space[2],
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

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Test a source'),

    h(Button, {
      onPress: () => setPickerOpen(!pickerOpen),
      testID: 'test-source-select',
      children: `${selected?.name ?? 'Pick a source'} ▾`,
    }),
    pickerOpen
      ? h(
          native.View as never,
          { accessibilityLabel: 'Source to test', style: { gap: tokens.space[1] } },
          ...sources.map((s) =>
            h(Button, {
              key: s.id,
              variant: s.id === selectedId ? 'secondary' : 'ghost',
              onPress: () => {
                setSelectedId(s.id)
                setPickerOpen(false)
                trace.clear()
              },
              testID: `test-source-option-${s.id}`,
              children: s.name,
            }),
          ),
        )
      : null,

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
        ], () => trace.run({ kind: 'stream', id: streamId.trim() }), !streamId.trim())
      : null,

    area('HTTP request — through this source\'s own client', 'test-run-http', [
      h(
        native.View as never,
        { key: 'method', style: { flexDirection: 'row', gap: tokens.space[2] } },
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
    h(TraceList, { events: trace.events, running: trace.running }),
  )
}

export const name = 'plugin-sources-ui-mobile'

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

export const inject = ['ui', 'sources']

export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SOURCES_VIEWS.library, bound(ctx, LibraryScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.album, bound(ctx, AlbumScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceList, bound(ctx, SourcesListScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceImport, bound(ctx, ImportScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceTest, bound(ctx, TestScreen))
  }, 'sources-ui-mobile')
}

export default { name, inject, apply }
