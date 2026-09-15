/**
 * React DOM views for `plugin-sources`.
 *
 * The library, search, source list, import and test screens. Every value comes
 * from a hook in the headless package — `useTracks`, `useAlbums`,
 * `useSourceSearch`, … — and this file is layout, gestures and event wiring
 * only (docs/08 1). The album page moved to `plugin-album-ui-desktop`, and the
 * library and search screens navigate to its route id.
 *
 * The one thing worth doing carefully here is the *three* states a catalogue
 * read has. A screen that treats loading, empty and failed the same shows a
 * blank pane and tells the user nothing about which one they are looking at.
 */

import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Album, CatalogQuery, DownloadsService, ImportReport, ScanSpecifiedDir, ScannerService, StreamQuality, Track, TraceEvent, UiService } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import {
  isLocalSource,
  playFromList,
  searchResultRows,
  useAlbums,
  useLocalFolders,
  useSearchSourceSelection,
  useSourceImport,
  useSourceSearch,
  useSourceTrace,
  useSources,
  useTracks,
  type SearchResultRow,
} from '@BBeBee/plugin-sources/hooks'
import {
  Artwork,
  Button,
  ContextMenu,
  EmptyState,
  IconButton,
  JsonTree,
  List,
  Text,
  TextField,
  TrackRow,
} from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import type { ArtworkProps, TrackRowProps } from '@BBeBee/ui-core'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { useToggleFavorite } from '@BBeBee/plugin-library/hooks'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 *
 * A component rather than a bare hook call at each site because list rows
 * render from callbacks: the hook suppresses the remote URL while the cache
 * fetches, so the fallback paints instead of a second request.
 */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

/** `TrackRow` renders its own `Artwork`; this is the same resolution for its track. */
function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}

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
  // One heart, two stores: `track_stats.loved` draws it, the library shelf
  // lists it. See `useToggleFavorite` in `@BBeBee/plugin-library/hooks`.
  const toggleFavorite = useToggleFavorite(ctx)

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
    serviceOf<UiService>(ctx, 'ui')?.navigate(ALBUM_VIEWS.album, { urn })
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
              query,
              onToggleLoved: (urn, loved) => void toggleFavorite(urn, loved),
              onEndReached: tracks.loadMore,
            })
          : h(AlbumGrid, {
              ctx,
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
  query,
  onToggleLoved,
  onEndReached,
}: {
  ctx: Context
  tracks: readonly Track[]
  scope: LibraryScope
  query: CatalogQuery
  onToggleLoved: (urn: string, loved: boolean) => void
  onEndReached: () => void
}): ReactElement {
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const menu = useTrackMenu(ctx)
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

  return h(
    Fragment,
    null,
    h(List<Track>, {
    items: tracks,
    accessibilityLabel: 'Tracks',
    estimatedItemSize: tokens.size.row,
    keyExtractor: (track) => track.urn,
    onEndReached,
    empty,
    renderItem: (track) =>
      h(CachedTrackRow, { ctx,
        track,
        showAlbum: true,
        // A tap plays the track in the list it was tapped in: jump if the
        // queue already holds it, otherwise that whole list — the library,
        // the local one, the favourites — becomes the queue (docs/05 §2).
        // Playback announces itself in the transport bar; no navigation.
        onPress: () => void playFromList(ctx, track.urn, { query }),
        onToggleLoved: () => onToggleLoved(track.urn, !track.loved),
        // Left absent when no downloads service is loaded: a button that does
        // nothing is worse than one that is not there (docs/08 §3).
        onDownload: downloads ? () => void downloads.enqueue([track.urn]) : undefined,
        onMore: (anchor) => menu.open({ track }, anchor),
      }),
    }),
    h(ContextMenu, menu.menuProps),
  )
}

function AlbumGrid({
  ctx,
  albums,
  scope,
  onOpenAlbum,
  onEndReached,
}: {
  ctx: Context
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
        h(CachedArtwork, { ctx, artwork: album.artwork, seed: album.urn, size: tokens.size.artworkThumb }),
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

/* ── search ────────────────────────────────────────────────────────────── */

/**
 * Search the selected sources, one section per source.
 *
 * Two layouts, not one: before the first search the box and the source toggles
 * are a hero, centred in the pane; afterwards both collapse to the top and the
 * rest of the height belongs to the results. The switch is a state change
 * rather than an animation — a transition that never settles would leave a
 * result list half-way down the screen.
 */
export function SearchScreen({
  ctx,
  query,
  onOpenAlbum,
}: {
  ctx: Context
  query?: string
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const scheme = p()
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const selection = useSearchSourceSelection(ctx)
  const search = useSourceSearch(ctx)
  const [text, setText] = useState(query ?? '')
  const menu = useTrackMenu(ctx)

  const submitted = search.status !== 'idle'
  const busy = search.status === 'loading'
  const canSearch = text.trim().length > 0 && selection.selectedIds.length > 0 && !busy
  const submit = () => {
    if (canSearch) {
      search.run(text, {
        sourceIds: selection.selectedIds,
        typesBySource: selection.typesBySource,
      })
    }
  }
  const clear = () => {
    search.reset()
    setText('')
  }

  const rows = searchResultRows(
    search.data,
    (sourceId) => selection.options.find((option) => option.id === sourceId)?.name ?? sourceId,
  )

  const openAlbum = (urn: string) => {
    onOpenAlbum?.(urn)
    serviceOf<UiService>(ctx, 'ui')?.navigate(ALBUM_VIEWS.album, { urn })
  }

  return h(
    Fragment,
    null,
    h(
    'section',
    {
      'aria-label': 'Search',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: tokens.space[4],
        gap: tokens.space[4],
      },
    },
    // The search bar with its source chips directly beneath it. Both stay
    // pinned at the top in either state — the results never push the controls
    // off screen, and the chips never float away from what they configure.
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h(TextField, {
            value: text,
            onChange: setText,
            placeholder: 'Songs, albums, artists…',
            accessibilityLabel: 'Search query',
            testID: 'search-input',
          }),
        ),
        h(Button, {
          onPress: submit,
          disabled: !canSearch,
          loading: busy,
          testID: 'search-submit',
          children: 'Search',
        }),
        submitted
          ? h(Button, { variant: 'ghost', onPress: clear, testID: 'search-clear', children: 'Clear' })
          : null,
      ),
      h(
        'div',
        {
          role: 'group',
          'aria-label': 'Sources and interfaces to search',
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: tokens.space[1],
          },
        },
        // One toggle per *interface*, not per source: a backend whose user
        // search is a separate endpoint offers songs and artists as two
        // independently searchable things, and the user may want one without
        // the other. A source with a single interface still gets a chip
        // labelled with it, so the row always says what is being searched.
        ...selection.interfaces.map((iface) =>
          h(SourceChip, {
            key: iface.id,
            label: `${iface.sourceName} · ${iface.kind === 'track' ? 'Songs' : 'Artists'}`,
            selected: selection.isInterfaceSelected(iface.id),
            disabled: !iface.searchable,
            onPress: () => selection.toggleInterface(iface.id),
            accessibilityLabel: `${selection.isInterfaceSelected(iface.id) ? 'Do not search' : 'Search'} ${iface.sourceName} ${iface.kind === 'track' ? 'songs' : 'artists'}`,
            testID: `search-source-${iface.sourceId}-${iface.kind}`,
          }),
        ),
        selection.interfaces.some((iface) => iface.searchable)
          ? h(SourceChip, {
              label: selection.allSelected ? 'None' : 'All',
              selected: false,
              onPress: selection.toggleAll,
              accessibilityLabel: selection.allSelected ? 'Deselect every source' : 'Select every source',
              testID: 'search-toggle-all',
            })
          : null,
      ),
    ),
    !submitted
      ? null
      : search.status === 'error' && search.error
        ? h(EmptyState, {
            icon: '⚠',
            title: 'Search failed',
            description: search.error.message,
            action: h(Button, {
              variant: 'secondary',
              onPress: () =>
                search.run(search.text, {
                  sourceIds: selection.selectedIds,
                  typesBySource: selection.typesBySource,
                }),
              children: 'Try again',
            }),
          })
        : busy
          ? h(EmptyState, {
              title: `Searching for “${search.text}”…`,
              description: 'Waiting for every selected source to answer.',
            })
          : h(
              'div',
              { style: { flex: 1, minHeight: 0 } },
              h(List<SearchResultRow>, {
                items: rows,
                accessibilityLabel: 'Search results',
                estimatedItemSize: tokens.size.row,
                keyExtractor: (row) => row.key,
                empty: h(EmptyState, {
                  icon: '🔎',
                  title: 'Nothing found',
                  description: 'No selected source had a match. Try a different search or source set.',
                }),
                renderItem: (row) =>
                  row.kind === 'header'
                    ? h(
                        'div',
                        {
                          role: 'heading',
                          'aria-level': 2,
                          style: {
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: tokens.space[2],
                            padding: `${tokens.space[3]}px ${tokens.space[2]}px ${tokens.space[1]}px`,
                          },
                        },
                        h(Text, { variant: 'md' }, row.name),
                        h(
                          Text,
                          {
                            variant: 'sm',
                            tone: row.status === 'error' ? 'error' : 'muted',
                          },
                          row.detail,
                        ),
                      )
                    : row.kind === 'track'
                      ? h(CachedTrackRow, { ctx,
                          track: row.track,
                          showAlbum: true,
                          onPress: () =>
                            void playFromList(ctx, row.track.urn, {
                              urns: row.queue,
                              context: { kind: 'search', label: search.text },
                            }),
                          onDownload: downloads ? () => void downloads.enqueue([row.track.urn]) : undefined,
                          onMore: (anchor) => menu.open({ track: row.track }, anchor),
                        })
                      : row.kind === 'album'
                        ? h(
                            'button',
                            {
                              type: 'button',
                              onClick: () => openAlbum(row.album.urn),
                              'aria-label': row.album.title,
                              style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: tokens.space[3],
                                width: '100%',
                                padding: tokens.space[2],
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                color: scheme.text.primary,
                              },
                            },
                            h(CachedArtwork, { ctx,
                              artwork: row.album.artwork,
                              seed: row.album.urn,
                              size: tokens.size.artworkThumb,
                            }),
                            h(
                              'span',
                              { style: { textAlign: 'left', minWidth: 0 } },
                              h(Text, { numberOfLines: 1, children: row.album.title }),
                              h(Text, {
                                variant: 'sm',
                                tone: 'muted',
                                numberOfLines: 1,
                                children: row.album.artists?.map((a) => a.name).join(', ') ?? '',
                              }),
                            ),
                          )
                        : h(ResultLine, { ctx, row }),
              }),
            ),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/**
 * A source toggle.
 *
 * Deliberately not `Button`: the kit's control is sized for a primary action
 * (44px, the platform's minimum), and a row of those is a wall under the
 * search box. A chip is the filter-sized control the design language calls
 * for, and the *selection* it edits already lives in the headless hooks — so
 * this is layout, the half a view package is allowed to write twice.
 */
function SourceChip({
  label,
  selected,
  disabled = false,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string
  selected: boolean
  disabled?: boolean
  onPress: () => void
  accessibilityLabel: string
  testID: string
}): ReactElement {
  const scheme = p()
  const [hovered, setHovered] = useState(false)
  const interactive = hovered && !disabled
  return h(
    'button',
    {
      type: 'button',
      disabled,
      onClick: disabled ? undefined : onPress,
      'aria-pressed': selected,
      'aria-label': accessibilityLabel,
      'data-testid': testID,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style: {
        // Small enough to read as a filter, tall enough to hit: 26px is above
        // the WCAG 2.2 target-size floor with the gaps between chips.
        minHeight: 26,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.pill,
        border: `1px solid ${
          selected ? 'transparent' : interactive ? scheme.border.strong : scheme.border.subtle
        }`,
        background: selected ? (interactive ? scheme.accent.hover : scheme.accent.base) : 'transparent',
        color: selected ? scheme.accent.on : interactive ? scheme.text.primary : scheme.text.secondary,
        fontFamily: tokens.font.family.ui,
        fontSize: tokens.font.size.xs,
        fontWeight: tokens.font.weight.bold,
        letterSpacing: 0.3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `background-color ${tokens.duration.fast}ms, color ${tokens.duration.fast}ms, border-color ${tokens.duration.fast}ms`,
      },
    },
    label,
  )
}

/**
 * A non-playable hit — an artist or a playlist.
 *
 * An artist row is a line of text rather than a card: there is no artist
 * screen to open yet, and a row that looks pressable but is not is worse than
 * one that plainly is not.
 */
function ResultLine({
  ctx,
  row,
}: {
  ctx: Context
  row: Extract<SearchResultRow, { kind: 'artist' | 'playlist' }>
}): ReactElement {
  const subtitle = row.kind === 'playlist' ? row.playlist.owner : undefined
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        padding: tokens.space[2],
      },
    },
    h(CachedArtwork, { ctx,
      artwork: row.kind === 'playlist' ? row.playlist.artwork : row.artist.artwork,
      seed: row.kind === 'playlist' ? row.playlist.urn : row.artist.urn,
      size: tokens.size.artworkThumb,
    }),
    h(
      'span',
      { style: { minWidth: 0 } },
      h(Text, {
        numberOfLines: 1,
        children: row.kind === 'playlist' ? row.playlist.name : row.artist.name,
      }),
      subtitle
        ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: subtitle })
        : null,
    ),
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
      ? h(JsonTree, { value: parsed, accessibilityLabel: event.label, controls: true })
      : text,
  )
}

/* ── the source list ───────────────────────────────────────────────────── */

/**
 * The imported sources — the hub everything else hangs off.
 *
 * Each row carries the two controls a source needs: **use / do not use**,
 * which stops the runtime asking it anything while keeping its cached library
 * browsable, and **delete**, which is the destructive half and asks once
 * before it takes the cached rows with it (docs/06 §4.1).
 *
 * The local-files row is the exception, because it is not an imported
 * document: the scanner writes it so the catalogue has a source to key on, and
 * what actually makes up "this device" is its folders. Those are shown on the
 * row itself, with the same use/delete controls the Music folders screen
 * offers — so the list answers "which folders is my local music coming from?"
 * without a trip to another settings page.
 */
export function SourcesListScreen({ ctx }: { ctx: Context }): ReactElement {
  const scheme = p()
  const sources = useSources(ctx)
  const folders = useLocalFolders(ctx)
  const scanner = serviceOf<ScannerService>(ctx, 'scanner')
  /** The row whose delete button has been pressed once. */
  const [confirming, setConfirming] = useState<string | undefined>(undefined)

  const removeSource = (id: string) => {
    setConfirming(undefined)
    // `forgetCatalogue` because this is the *delete* button, not the switch:
    // the row goes and the cascade takes its cached tracks, exactly as the
    // service documents. The switch above is the keep-the-library path.
    void ctx.sources.remove(id, { forgetCatalogue: true })
  }

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
          ...sources.map((source) => {
            const local = isLocalSource(source)
            return h(
              'li',
              {
                key: source.id,
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: tokens.space[2],
                  padding: tokens.space[3],
                  borderRadius: tokens.radius.sm,
                  background: scheme.bg.raised,
                  opacity: source.enabled ? 1 : 0.6,
                },
              },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: tokens.space[3],
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
                  // The local row has no enable switch of its own: it exists so
                  // the catalogue has a source to key on, and its folders are
                  // what can be switched off.
                  !local
                    ? h(Button, {
                        variant: source.enabled ? 'ghost' : 'secondary',
                        onPress: () => void ctx.sources.setEnabled(source.id, !source.enabled),
                        accessibilityLabel: source.enabled ? `Stop using ${source.name}` : `Use ${source.name}`,
                        testID: `sources-list-toggle-${source.id}`,
                        children: source.enabled ? 'Disable' : 'Enable',
                      })
                    : null,
                  !local
                    ? confirming === source.id
                      ? h(
                          'div',
                          { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' } },
                          h(Text, { variant: 'sm', tone: 'warn' }, 'Delete source and its cached tracks?'),
                          h(Button, {
                            onPress: () => removeSource(source.id),
                            accessibilityLabel: `Delete ${source.name} and its cached tracks`,
                            testID: `sources-list-delete-confirm-${source.id}`,
                            children: 'Delete',
                          }),
                          h(Button, {
                            variant: 'ghost',
                            onPress: () => setConfirming(undefined),
                            children: 'Cancel',
                          }),
                        )
                      : h(IconButton, {
                          icon: '🗑',
                          accessibilityLabel: `Delete ${source.name}`,
                          onPress: () => setConfirming(source.id),
                          testID: `sources-list-delete-${source.id}`,
                        })
                    : null,
                ),
              ),
              local ? h(LocalFolders, { folders, scanner }) : null,
            )
          }),
        ),
  )
}

/**
 * The folders behind the local source, said on the source's own row.
 *
 * The same elements the Music folders screen manages, read through
 * `ctx.scanner` where it exists: a phone without the scanner still renders the
 * source list, minus this section rather than crashing on it.
 */
function LocalFolders({
  folders,
  scanner,
}: {
  folders: readonly ScanSpecifiedDir[]
  scanner: ScannerService | undefined
}): ReactElement | null {
  const scheme = p()
  if (!scanner) return null
  if (folders.length === 0) {
    return h(Text, {
      variant: 'sm',
      tone: 'muted',
      children: 'No folders yet — add one under Settings → Music folders.',
    })
  }
  return h(
    'ul',
    {
      'aria-label': 'Local music folders',
      style: {
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[1],
        borderTop: `1px solid ${scheme.border.subtle}`,
        paddingTop: tokens.space[2],
      },
    },
    ...folders.map((dir) =>
      h(
        'li',
        {
          key: dir.id,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: tokens.space[3],
            opacity: dir.enabled ? 1 : 0.5,
          },
        },
        h(
          'div',
          { style: { minWidth: 0 } },
          h(Text, { variant: 'sm', numberOfLines: 1 }, dir.uri),
          dir.lastError
            ? h(Text, { variant: 'sm', tone: 'error', numberOfLines: 1, children: dir.lastError })
            : null,
        ),
        h(
          'div',
          { style: { display: 'flex', gap: tokens.space[2], flexShrink: 0 } },
          h(Button, {
            variant: 'ghost',
            onPress: () => void scanner.setEnabled(dir.id, !dir.enabled),
            accessibilityLabel: dir.enabled ? `Disable ${dir.uri}` : `Enable ${dir.uri}`,
            testID: `source-folder-toggle-${dir.id}`,
            children: dir.enabled ? 'Disable' : 'Enable',
          }),
          // Keeps the tracks, like Music folders: losing a library to a
          // mis-clicked button is far worse than a stale row.
          h(IconButton, {
            icon: '🗑',
            accessibilityLabel: `Remove ${dir.uri}`,
            onPress: () => void scanner.removeSpecifiedDir(dir.id),
            testID: `source-folder-remove-${dir.id}`,
          }),
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
    yield ctx.ui.registerView(SOURCES_VIEWS.search, bound(ctx, SearchScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceList, bound(ctx, SourcesListScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceImport, bound(ctx, ImportScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceTest, bound(ctx, TestScreen))
  }, 'sources-ui-desktop')
}

export default { name, inject, apply }
