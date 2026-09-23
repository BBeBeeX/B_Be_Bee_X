import { createElement as h, Fragment, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { DownloadsService, UiService } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { useTrackMenu } from '@BBeBee/ui-menus'
import {
  playFromList,
  searchResultRows,
  useSearchSourceSelection,
  useSourceSearch,
  type SearchInterfaceKind,
  type SearchResultRow,
} from '@BBeBee/plugin-sources/hooks'
import {
  Button,
  ContextMenu,
  EmptyState,
  List,
  Text,
  TextField,
} from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, CachedTrackRow } from '../components/CachedArtwork.js'

const p = () => palettes.dark

export function SearchScreen({
  ctx,
  query,
  sourceIds: initialSourceIds,
  typesBySource: initialTypesBySource,
  searchTimestamp,
  onOpenAlbum,
}: {
  ctx: Context
  query?: string
  sourceIds?: readonly string[]
  typesBySource?: Readonly<Record<string, readonly SearchInterfaceKind[]>>
  searchTimestamp?: number
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const scheme = p()
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const search = useSourceSearch(ctx)
  const selection = useSearchSourceSelection(ctx)
  const [text, setText] = useState(query ?? '')
  const menu = useTrackMenu(ctx)
  const lastSearchKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (query && query.trim().length > 0) {
      const trimmed = query.trim()
      setText(trimmed)
      const targetSourceIds = initialSourceIds ?? selection.selectedIds
      const targetTypesBySource = initialTypesBySource ?? selection.typesBySource
      const searchKey = `${trimmed}:${searchTimestamp ?? ''}:${targetSourceIds.join(',')}`
      if (targetSourceIds.length > 0 && lastSearchKeyRef.current !== searchKey) {
        lastSearchKeyRef.current = searchKey
        search.run(trimmed, {
          sourceIds: targetSourceIds,
          typesBySource: targetTypesBySource,
        })
      }
    }
  }, [query, searchTimestamp, initialSourceIds, initialTypesBySource, selection.selectedIds, selection.typesBySource])

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
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
        h(
          'form',
          {
            onSubmit: (e: { preventDefault: () => void }) => {
              e.preventDefault()
              submit()
            },
            style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] },
          },
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
                        ? h(CachedTrackRow, {
                            ctx,
                            track: row.track,
                            showAlbum: true,
                            onPress: () =>
                              void playFromList(ctx, row.track.urn, {
                                urns: [row.track.urn],
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
                              h(CachedArtwork, {
                                ctx,
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
    h(CachedArtwork, {
      ctx,
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
