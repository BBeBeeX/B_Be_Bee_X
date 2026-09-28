import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Album, PlayerService, Track } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { serviceOf, type MenuAnchor, type MenuItemSpec } from '@BBeBee/ui-core'
import { ContextMenu, EmptyState, List, SaveToPlaylistPopover, StickyDetailBar, Text, tablerIcon, useDetailBarCollapse, viewModeMenuItems, useViewMode, headerGradient } from '@BBeBee/ui-kit-desktop'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork } from '../components/CachedArtwork.js'
import { LocalAlbumCard } from '../components/LocalAlbumCard.js'
import { TrackLibraryActionButton } from '../components/TrackLibraryActionButton.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'
import { fetchAllLocalAlbums, fetchAllLocalTracks, formatDuration } from '../utils/data-helpers.js'

function LocalTrackTableRow({
  ctx,
  track,
  index,
  inLibrary,
  compact,
  onPress,
  onMore,
  onAddToFavorites,
  onOpenPlaylistMenu,
  onOpenAlbum,
}: {
  ctx: Context
  track: Track
  index: number
  inLibrary: boolean
  /** 紧凑视图：无封面，艺人独立成列。 */
  compact?: boolean
  onPress: () => void
  onMore: (anchor: { x: number; y: number }) => void
  onAddToFavorites?: (track: Track) => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
  onOpenAlbum?: (track: Track) => void
}): ReactElement {
  const [hovered, setHovered] = useState(false)
  const artists = track.artists?.map((a) => a.name).join(', ')

  return h(
    'div',
    {
      role: 'row',
      tabIndex: 0,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick: onPress,
      onContextMenu: (e: ReactMouseEvent) => {
        e.preventDefault()
        onMore({ x: e.clientX, y: e.clientY })
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') onPress()
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        height: 56,
        padding: '0 32px',
        borderRadius: 4,
        cursor: 'pointer',
        background: hovered ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
        transition: 'background-color 0.15s ease',
        boxSizing: 'border-box',
      },
    },
    // Col 1: # or Play icon
    h(
      'div',
      {
        style: {
          width: 40,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          color: hovered ? '#FFFFFF' : '#b3b3b3',
        },
      },
      hovered ? tablerIcon('play', { size: 18, color: '#FFFFFF' }) : String(index + 1),
    ),
    // Col 2: Artwork (list only) + Title + Artist
    h(
      'div',
      {
        style: {
          flex: 2,
          minWidth: 0,
          paddingLeft: 12,
          paddingRight: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        },
      },
      compact
        ? null
        : h(
            'div',
            {
              style: {
                width: 40,
                height: 40,
                borderRadius: 4,
                overflow: 'hidden',
                flexShrink: 0,
                backgroundColor: '#282828',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              },
            },
            track.artwork
              ? h(CachedArtwork, { ctx, artwork: track.artwork, seed: track.urn, size: 40, radius: 4 })
              : tablerIcon('music', { size: 22, color: '#7f7f7f' }),
          ),
      h(
        'div',
        {
          style: {
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          },
        },
        h(
          'span',
          {
            style: {
              color: '#FFFFFF',
              fontSize: 15,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          track.title,
        ),
        !compact && artists
          ? h(
              'span',
              {
                style: {
                  color: '#b3b3b3',
                  fontSize: 13,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              artists,
            )
          : null,
      ),
    ),
    // Col 3 (compact only): Artist as its own column
    compact
      ? h(
          'div',
          {
            style: {
              flex: 1,
              minWidth: 0,
              paddingRight: 16,
              fontSize: 13,
              color: '#b3b3b3',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          artists || '-',
        )
      : null,
    // Col 3: Album
    h(
      'div',
      {
        style: {
          flex: 1.5,
          minWidth: 0,
          paddingRight: 16,
          fontSize: 14,
          color: '#b3b3b3',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
      track.albumTitle
        ? h(
            'span',
            {
              role: 'button',
              tabIndex: 0,
              'data-testid': `track-album-link-${track.urn}`,
              'aria-label': `查看专辑：${track.albumTitle}`,
              title: `查看专辑：${track.albumTitle}`,
              onClick: (e: ReactMouseEvent) => {
                e.stopPropagation()
                onOpenAlbum?.(track)
              },
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  onOpenAlbum?.(track)
                }
              },
              style: {
                cursor: 'pointer',
                transition: 'color 0.15s ease',
              },
              onMouseEnter: (e: ReactMouseEvent<HTMLSpanElement>) => {
                e.currentTarget.style.color = '#FFFFFF'
                e.currentTarget.style.textDecoration = 'underline'
              },
              onMouseLeave: (e: ReactMouseEvent<HTMLSpanElement>) => {
                e.currentTarget.style.color = '#b3b3b3'
                e.currentTarget.style.textDecoration = 'none'
              },
            },
            track.albumTitle,
          )
        : '-',
    ),
    // Col 4: Checkmark + Duration & actions
    h(
      'div',
      {
        style: {
          width: 120,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          paddingRight: 16,
        },
      },
      h(TrackLibraryActionButton, {
        track,
        hovered,
        inLibrary,
        onAddToFavorites: () => onAddToFavorites?.(track),
        onOpenPlaylistMenu,
      }),
      h(
        'span',
        {
          style: {
            fontSize: 14,
            color: '#b3b3b3',
            width: 45,
            textAlign: 'right',
          },
        },
        formatDuration(track.durationMs),
      ),
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'More',
          title: '更多',
          onClick: (e: ReactMouseEvent) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          },
          style: {
            background: 'none',
            border: 'none',
            color: '#b3b3b3',
            cursor: 'pointer',
            padding: 4,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
          },
        },
        tablerIcon('dots', { size: 20 }),
      ),
    ),
  )
}

type LocalTrackSortKey = 'default' | 'title' | 'artist' | 'album' | 'duration'
type LocalAlbumSortKey = 'default' | 'title' | 'artist' | 'year' | 'count'

/** 专辑的列表/紧凑行：平铺模式仍用 LocalAlbumCard 网格。 */
function LocalAlbumRow({
  ctx,
  album,
  compact,
  onOpen,
  onPlay,
}: {
  ctx: Context
  album: Album
  /** 紧凑视图：无封面，艺人独立成列。 */
  compact?: boolean
  onOpen: () => void
  onPlay?: () => void
}): ReactElement {
  const [hovered, setHovered] = useState(false)
  const artists = album.artists?.map((a) => a.name).join(', ') || '未知艺人'
  const meta = `${album.year ? `${album.year} • ` : ''}${album.trackCount ? `${album.trackCount} 首歌曲` : '专辑'}`

  return h(
    'div',
    {
      role: 'row',
      tabIndex: 0,
      'aria-label': album.title,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick: onOpen,
      style: {
        display: 'flex',
        alignItems: 'center',
        height: 56,
        padding: '0 32px',
        borderRadius: 4,
        cursor: 'pointer',
        background: hovered ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
        transition: 'background-color 0.15s ease',
        boxSizing: 'border-box',
      },
    },
    // Col 1: Cover (list only) or disc icon
    compact
      ? null
      : h(
          'div',
          {
            style: {
              width: 40,
              height: 40,
              borderRadius: 4,
              overflow: 'hidden',
              flexShrink: 0,
              backgroundColor: '#282828',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          album.artwork
            ? h(CachedArtwork, { ctx, artwork: album.artwork, seed: album.urn, size: 40, radius: 4 })
            : tablerIcon('disc', { size: 22, color: '#7f7f7f' }),
        ),
    // Col 2: Title (+ artists inline in list mode)
    h(
      'div',
      {
        style: {
          flex: 2,
          minWidth: 0,
          paddingLeft: compact ? 0 : 12,
          paddingRight: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        },
      },
      h(
        'div',
        {
          style: {
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          },
        },
        h(
          'span',
          {
            style: {
              color: '#FFFFFF',
              fontSize: 15,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          album.title,
        ),
        !compact
          ? h(
              'span',
              {
                style: {
                  color: '#b3b3b3',
                  fontSize: 13,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              artists,
            )
          : null,
      ),
    ),
    // Col 3 (compact only): Artist as its own column
    compact
      ? h(
          'div',
          {
            style: {
              flex: 1.5,
              minWidth: 0,
              paddingRight: 16,
              fontSize: 13,
              color: '#b3b3b3',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          artists,
        )
      : null,
    // Col 4: Year & count
    h(
      'div',
      {
        style: {
          flex: 1,
          minWidth: 0,
          paddingRight: 16,
          fontSize: 13,
          color: '#b3b3b3',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
      meta,
    ),
    // Col 5: Play on hover
    h(
      'button',
      {
        type: 'button',
        'aria-label': `播放 ${album.title}`,
        title: `播放 ${album.title}`,
        onClick: (e: ReactMouseEvent) => {
          e.stopPropagation()
          onPlay?.()
        },
        style: {
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
          color: '#ffffff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.15s ease',
        },
      },
      tablerIcon('play', { size: 20, color: '#ffffff' }),
    ),
  )
}

/** 表头吸顶时停在吸顶栏正下方。 */
const BAR_HEIGHT = 64
/** 表头悬停时列间的发丝分隔线。 */
const HOVER_DIVIDER = 'inset 1px 0 0 rgba(255, 255, 255, 0.08)'

export function LocalMusicScreen({ ctx }: { ctx: Context }): ReactElement {
  const [tracks, setTracks] = useState<readonly Track[]>([])
  const [albums, setAlbums] = useState<readonly Album[]>([])
  const [viewMode, setViewMode] = useState<'tracks' | 'albums'>('tracks')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')
  const [trackSortKey, setTrackSortKey] = useState<LocalTrackSortKey>('default')
  const [trackSortOrder, setTrackSortOrder] = useState<'asc' | 'desc'>('asc')
  const [albumSortKey, setAlbumSortKey] = useState<LocalAlbumSortKey>('default')
  const [albumSortOrder, setAlbumSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)
  const [headerHovered, setHeaderHovered] = useState(false)
  // 滚动折叠：吸顶栏在播放按钮靠近时滑入，滚过按钮一半高度时吸附（docked）。
  const collapse = useDetailBarCollapse({ barHeight: BAR_HEIGHT, anchorHeight: 56 })
  // 视图模式：歌曲页默认列表，专辑页默认平铺（卡片网格），选择按页记忆。
  const [trackViewMode, setTrackViewMode] = useViewMode('local-tracks', 'list', ['compact', 'list'] as const)
  const [albumViewMode, setAlbumViewMode] = useViewMode('local-albums', 'tiled', ['compact', 'list', 'tiled'] as const)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const menu = useTrackMenu(ctx)
  const {
    isTrackInLibrary,
    handleAddToFavorites,
    openAddToPlaylistMenu,
    saveToPlaylistMenuProps,
  } = useTrackLibraryInfo(ctx)


  useEffect(() => {
    let cancelled = false
    setLoading(true)
    if (!ctx.sources?.listTracks) {
      setLoading(false)
      return
    }

    const loadAlbums = fetchAllLocalAlbums(ctx.sources).catch(() => [] as Album[])

    Promise.all([fetchAllLocalTracks(ctx.sources), loadAlbums])
      .then(([loadedTracks, loadedAlbums]) => {
        if (!cancelled) {
          setTracks(loadedTracks)

          if (loadedAlbums.length > 0) {
            setAlbums(loadedAlbums)
          } else {
            // Synthesize albums from local tracks if listAlbums returned empty
            const map = new Map<string, Album>()
            for (const t of loadedTracks) {
              const albumTitle = t.albumTitle || '未知专辑'
              const key = t.albumUrn || `BBeBee:local:album:${encodeURIComponent(albumTitle)}`
              if (!map.has(key)) {
                map.set(key, {
                  urn: key,
                  title: albumTitle,
                  artists: t.artists || [],
                  year: t.year,
                  artwork: t.artwork,
                  trackCount: 1,
                })
              } else {
                const existing = map.get(key)!
                existing.trackCount = (existing.trackCount || 1) + 1
              }
            }
            setAlbums(Array.from(map.values()))
          }
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [ctx])

  const sortedTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matching = q
      ? tracks.filter((t) => {
          return (
            t.title.toLowerCase().includes(q) ||
            t.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
            t.albumTitle?.toLowerCase().includes(q)
          )
        })
      : [...tracks]

    if (trackSortKey === 'default') {
      return trackSortOrder === 'desc' ? matching.reverse() : matching
    }

    return matching.sort((a, b) => {
      let cmp = 0
      if (trackSortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (trackSortKey === 'artist') {
        const aArt = a.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (trackSortKey === 'album') {
        cmp = (a.albumTitle ?? '').localeCompare(b.albumTitle ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (trackSortKey === 'duration') {
        cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
      }
      return trackSortOrder === 'desc' ? -cmp : cmp
    })
  }, [tracks, searchQuery, trackSortKey, trackSortOrder])

  const sortedTrackUrns = useMemo(() => sortedTracks.map((t) => t.urn), [sortedTracks])

  const albumUrnByTitle = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of albums) {
      if (a.title) map.set(a.title, a.urn)
    }
    return map
  }, [albums])

  const handleOpenAlbum = (t: Track) => {
    const urn =
      t.albumUrn ||
      (t.albumTitle ? albumUrnByTitle.get(t.albumTitle) : undefined) ||
      (t.albumTitle ? `BBeBee:local:album:${encodeURIComponent(t.albumTitle)}` : undefined)
    if (urn) {
      ctx.ui.navigate(ALBUM_VIEWS.album, { urn })
    }
  }

  const sortedAlbums = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matching = q
      ? albums.filter((a) => {
          return (
            a.title.toLowerCase().includes(q) ||
            a.artists?.some((art) => art.name.toLowerCase().includes(q))
          )
        })
      : [...albums]

    if (albumSortKey === 'default') {
      return albumSortOrder === 'desc' ? matching.reverse() : matching
    }

    return matching.sort((a, b) => {
      let cmp = 0
      if (albumSortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (albumSortKey === 'artist') {
        const aArt = a.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (albumSortKey === 'year') {
        cmp = (a.year ?? 0) - (b.year ?? 0)
      } else if (albumSortKey === 'count') {
        cmp = (a.trackCount ?? 0) - (b.trackCount ?? 0)
      }
      return albumSortOrder === 'desc' ? -cmp : cmp
    })
  }, [albums, searchQuery, albumSortKey, albumSortOrder])

  const handleTrackHeaderClick = (key: LocalTrackSortKey) => {
    if (trackSortKey === key) {
      setTrackSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setTrackSortKey(key)
      setTrackSortOrder('asc')
    }
  }

  const renderTrackSortIndicator = (key: LocalTrackSortKey) => {
    // 表头默认不带箭头；悬停时当前排序列显示方向箭头，其余列显示浅色提示。
    if (!headerHovered) return null
    if (trackSortKey === key) {
      return trackSortOrder === 'asc'
        ? tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4 } })
        : tablerIcon('chevron-down', { size: 16, style: { marginLeft: 4 } })
    }
    return tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4, opacity: 0.35 } })
  }

  const trackSortLabelMap: Record<LocalTrackSortKey, string> = {
    default: '默认顺序',
    title: '标题',
    artist: '艺人',
    album: '专辑',
    duration: '时长',
  }

  const albumSortLabelMap: Record<LocalAlbumSortKey, string> = {
    default: '默认顺序',
    title: '专辑名称',
    artist: '艺人',
    year: '年份',
    count: '曲目数',
  }

  const trackSortMenuItems: MenuItemSpec[] = [
    {
      id: 'sort-default',
      label: '默认顺序',
      icon: trackSortKey === 'default' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setTrackSortKey('default'),
    },
    {
      id: 'sort-title',
      label: '标题',
      icon: trackSortKey === 'title' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setTrackSortKey('title'),
    },
    {
      id: 'sort-artist',
      label: '艺人',
      icon: trackSortKey === 'artist' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setTrackSortKey('artist'),
    },
    {
      id: 'sort-album',
      label: '专辑',
      icon: trackSortKey === 'album' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setTrackSortKey('album'),
    },
    {
      id: 'sort-duration',
      label: '时长',
      icon: trackSortKey === 'duration' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setTrackSortKey('duration'),
      divider: true,
    },
    {
      id: 'order-asc',
      label: '升序',
      icon: trackSortOrder === 'asc' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setTrackSortOrder('asc'),
    },
    {
      id: 'order-desc',
      label: '降序',
      icon: trackSortOrder === 'desc' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setTrackSortOrder('desc'),
    },
  ]

  const albumSortMenuItems: MenuItemSpec[] = [
    {
      id: 'sort-default',
      label: '默认顺序',
      icon: albumSortKey === 'default' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setAlbumSortKey('default'),
    },
    {
      id: 'sort-title',
      label: '专辑名称',
      icon: albumSortKey === 'title' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setAlbumSortKey('title'),
    },
    {
      id: 'sort-artist',
      label: '艺人',
      icon: albumSortKey === 'artist' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setAlbumSortKey('artist'),
    },
    {
      id: 'sort-year',
      label: '年份',
      icon: albumSortKey === 'year' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setAlbumSortKey('year'),
    },
    {
      id: 'sort-count',
      label: '曲目数',
      icon: albumSortKey === 'count' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setAlbumSortKey('count'),
      divider: true,
    },
    {
      id: 'order-asc',
      label: '升序',
      icon: albumSortOrder === 'asc' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setAlbumSortOrder('asc'),
    },
    {
      id: 'order-desc',
      label: '降序',
      icon: albumSortOrder === 'desc' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setAlbumSortOrder('desc'),
    },
  ]

  const renderPlayButton = (size: number, iconSize: number, testID: string | undefined) =>
    h(
      'button',
      {
        type: 'button',
        'data-testid': testID,
        'aria-label': '播放全部',
        onClick: () =>
          sortedTrackUrns[0] &&
          player?.playNow(sortedTrackUrns, { context: { kind: 'local', label: '本地音乐' } }),
        disabled: sortedTrackUrns.length === 0,
        style: {
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
          border: 'none',
          cursor: sortedTrackUrns.length === 0 ? 'not-allowed' : 'pointer',
          opacity: sortedTrackUrns.length === 0 ? 0.5 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--glow-brand-md, 0 8px 16px rgba(0, 0, 0, 0.3))',
          color: '#ffffff',
          paddingLeft: 2,
        },
      },
      tablerIcon('play', { size: iconSize, color: '#ffffff' }),
    )

  // 随列表一起滚走的部分：hero、视图切换、操作条、（歌曲模式的）表头。
  // 吸顶栏单独走 sticky 插槽/滚动容器的直接子节点。
  const stickyBar = h(StickyDetailBar, {
    title: '本地音乐',
    progress: collapse.slide,
    docked: collapse.docked,
    playButton: renderPlayButton(48, 24, 'local-music-play-sticky'),
  })

  // 渐变只存在于头部区域（随内容滚走），下方内容为纯色。
  const headerNode = h(
    'div',
    { style: { background: headerGradient(undefined) } },
    // Hero Header (No Cover)
    h(
      'header',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '36px 32px 18px 32px',
          flexShrink: 0,
        },
      },
      h(
        'span',
        { style: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#FFFFFF' } },
        '本地音乐',
      ),
      h(
        'h1',
        {
          style: {
            fontSize: 56,
            fontWeight: 900,
            margin: '2px 0 6px 0',
            lineHeight: 1.1,
            color: '#FFFFFF',
            letterSpacing: '-0.03em',
          },
        },
        viewMode === 'tracks' ? '本地文件' : '本地专辑',
      ),
      h(
        'p',
        { style: { margin: 0, fontSize: 14, color: '#b3b3b3' } },
        viewMode === 'tracks'
          ? `来自本地电脑的文件 • ${tracks.length} 首歌曲`
          : `来自本地电脑的专辑 • ${albums.length} 张专辑`,
      ),
    ),
    // View Mode Switcher: [ 歌曲 ]  [ 专辑 ]
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 32px 16px 32px',
          flexShrink: 0,
        },
      },
      h(
        'button',
        {
          type: 'button',
          onClick: () => setViewMode('tracks'),
          'data-testid': 'local-tab-tracks',
          style: {
            background: viewMode === 'tracks' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.1)',
            color: viewMode === 'tracks' ? '#000000' : '#FFFFFF',
            border: 'none',
            borderRadius: 20,
            padding: '6px 18px',
            fontSize: 14,
            fontWeight: viewMode === 'tracks' ? 700 : 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          },
        },
        '歌曲',
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () => setViewMode('albums'),
          'data-testid': 'local-tab-albums',
          style: {
            background: viewMode === 'albums' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.1)',
            color: viewMode === 'albums' ? '#000000' : '#FFFFFF',
            border: 'none',
            borderRadius: 20,
            padding: '6px 18px',
            fontSize: 14,
            fontWeight: viewMode === 'albums' ? 700 : 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          },
        },
        '专辑',
      ),
    ),
    // Action Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px 18px 32px',
          flexShrink: 0,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 24 } },
        // 折叠锚点：吸顶栏按这只大按钮的位置决定滑入与吸附时机。
        h('div', { ref: collapse.anchorRef, style: { display: 'flex' } }, renderPlayButton(56, 28, 'local-music-play')),
        h(
          'button',
          {
            type: 'button',
            title: '随机播放',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: () => {
              if (sortedTrackUrns.length > 0) {
                const shuffled = [...sortedTrackUrns].sort(() => Math.random() - 0.5)
                void player?.playNow(shuffled, { context: { kind: 'local', label: '本地音乐' } })
              }
            },
          },
          tablerIcon('shuffle', { size: 26 }),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 16,
              padding: '4px 10px',
              gap: 6,
            },
          },
          tablerIcon('search', { size: 18, color: '#b3b3b3' }),
          h('input', {
            type: 'text',
            placeholder: viewMode === 'tracks' ? '在本地文件中搜索' : '在本地专辑中搜索',
            value: searchQuery,
            onChange: (e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value),
            style: {
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#FFFFFF',
              fontSize: 13,
              width: 140,
            },
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: () => ctx.ui.navigate('scanner.settings'),
            title: '扫描目录设置',
            style: {
              background: 'none',
              border: 'none',
              color: '#b3b3b3',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: 4,
            },
          },
          tablerIcon('settings', { size: 22 }),
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 6,
            },
          },
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'local-music-sort-trigger',
              title: '排序方式',
              onClick: (e: ReactMouseEvent) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setSortMenuAnchor({ x: rect.left, y: rect.bottom + 6 })
              },
              style: {
                background: 'none',
                border: 'none',
                color: '#b3b3b3',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: 0,
              },
            },
            h('span', null, viewMode === 'tracks' ? trackSortLabelMap[trackSortKey] : albumSortLabelMap[albumSortKey]),
            tablerIcon('list', { size: 20 }),
          ),
        ),
      ),
    ),
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
  )

  // 表头走 stickyHeader 插槽（滚动容器的直接子节点）——嵌在 header 盒内时
  // sticky 只在父盒范围吸附，作为父盒最后一个子元素等于完全吸不住。
  const tableHeaderNode = viewMode === 'tracks'
    ? h(
        'div',
        {
          key: 'track-table-header',
          onMouseEnter: () => setHeaderHovered(true),
            onMouseLeave: () => setHeaderHovered(false),
            style: {
              display: 'flex',
              alignItems: 'center',
              padding: '0 32px 8px 32px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#b3b3b3',
              fontSize: 13,
              fontWeight: 500,
              flexShrink: 0,
              position: 'sticky',
              top: BAR_HEIGHT,
              zIndex: 15,
              background: collapse.docked ? 'var(--bg-primary, #080A10)' : 'transparent',
            },
          },
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'local-sort-default',
              onClick: () => handleTrackHeaderClick('default'),
              style: {
                width: 40,
                textAlign: 'center',
                flexShrink: 0,
                background: 'none',
                border: 'none',
                color: trackSortKey === 'default' ? '#FFFFFF' : '#b3b3b3',
                cursor: 'pointer',
                padding: 0,
                fontSize: 13,
                fontWeight: 500,
                boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
              },
            },
            '#',
            renderTrackSortIndicator('default'),
          ),
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'local-sort-title',
              onClick: () => handleTrackHeaderClick('title'),
              style: {
                flex: 2,
                paddingLeft: 12,
                textAlign: 'left',
                background: 'none',
                border: 'none',
                color: trackSortKey === 'title' ? '#FFFFFF' : '#b3b3b3',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
              },
            },
            '标题',
            renderTrackSortIndicator('title'),
          ),
          trackViewMode === 'compact'
            ? h(
                'div',
                {
                  key: 'local-header-artist',
                  style: {
                    flex: 1,
                    minWidth: 0,
                    textAlign: 'left',
                    color: '#b3b3b3',
                    fontSize: 13,
                    fontWeight: 500,
                    boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
                  },
                },
                '艺人',
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'local-sort-album',
              onClick: () => handleTrackHeaderClick('album'),
              style: {
                flex: 1.5,
                paddingLeft: 8,
                textAlign: 'left',
                background: 'none',
                border: 'none',
                color: trackSortKey === 'album' ? '#FFFFFF' : '#b3b3b3',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
              },
            },
            '专辑',
            renderTrackSortIndicator('album'),
          ),
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'local-sort-duration',
              onClick: () => handleTrackHeaderClick('duration'),
              style: {
                width: 120,
                textAlign: 'right',
                paddingRight: 40,
                flexShrink: 0,
                background: 'none',
                border: 'none',
                color: trackSortKey === 'duration' ? '#FFFFFF' : '#b3b3b3',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 4,
                boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
              },
            },
            tablerIcon('clock', { size: 18 }),
            renderTrackSortIndicator('duration'),
          ),
        )
      : null

  // 专辑模式的内容（平铺网格或行列表），直接在滚动流里，不再自带滚动容器。
  const albumsContent = loading
    ? h(EmptyState, { key: 'album-loading', title: '加载中…' })
    : sortedAlbums.length === 0
    ? h(EmptyState, {
        key: 'album-empty',
        icon: 'disc',
        title: '暂无本地专辑',
        description: '添加包含专辑信息的本地音乐文件夹后，专辑将在此显示。',
      })
    : albumViewMode === 'tiled'
    ? h(
        'div',
        {
          key: 'album-grid',
          style: {
            padding: '8px 32px 32px 32px',
          },
        },
        h(
          'div',
          {
            'data-testid': 'local-albums-grid',
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 24,
            },
          },
          sortedAlbums.map((album) =>
            h(LocalAlbumCard, {
              key: album.urn,
              ctx,
              album,
              onOpen: () => ctx.ui.navigate(ALBUM_VIEWS.album, { urn: album.urn }),
              onPlay: () => {
                const albumTracks = tracks.filter(
                  (t) => t.albumUrn === album.urn || (album.title && t.albumTitle === album.title),
                )
                const urns = albumTracks.map((t) => t.urn)
                if (urns[0]) {
                  void player?.playNow(urns, {
                    context: { kind: 'album', label: album.title ?? '本地音乐' },
                  })
                }
              },
            }),
          ),
        ),
      )
    : h(
        'div',
        { key: 'album-list', style: { padding: '8px 0 32px 0' } },
        sortedAlbums.map((album) =>
          h(LocalAlbumRow, {
            key: album.urn,
            ctx,
            album,
            compact: albumViewMode === 'compact',
            onOpen: () => ctx.ui.navigate(ALBUM_VIEWS.album, { urn: album.urn }),
            onPlay: () => {
              const albumTracks = tracks.filter(
                (t) => t.albumUrn === album.urn || (album.title && t.albumTitle === album.title),
              )
              const urns = albumTracks.map((t) => t.urn)
              if (urns[0]) {
                void player?.playNow(urns, {
                  context: { kind: 'album', label: album.title ?? '本地音乐' },
                })
              }
            },
          }),
        ),
      )

  return h(
    'section',
    {
      'aria-label': '本地音乐',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary, #080A10)',
        color: '#FFFFFF',
        overflow: 'hidden',
      },
    },
    viewMode === 'tracks'
      ? // 歌曲模式：头部随虚拟列表一起滚动，吸顶栏浮在其上。
        h(
          'div',
          { key: 'track-list-container', ref: collapse.scrollerRef, style: { flex: 1, minHeight: 0 } },
          loading
            ? h('div', { style: { overflowY: 'auto', height: '100%' } }, stickyBar, headerNode, h(EmptyState, { title: '加载中…' }))
            : h(List<Track>, {
                testID: 'local-tracks-list',
                header: headerNode,
                sticky: stickyBar,
                stickyHeader: tableHeaderNode ?? undefined,
                onScroll: collapse.handleScroll,
                items: sortedTracks,
                estimatedItemSize: tokens.size.row,
                keyExtractor: (t) => t.urn,
                empty: h(EmptyState, {
                  icon: 'folder',
                  title: '暂无本地音乐',
                  description: '添加音乐文件夹后，扫描的歌曲将在此显示。',
                }),
                renderItem: (t, index) =>
                  h(LocalTrackTableRow, {
                    ctx,
                    track: t,
                    index,
                    inLibrary: isTrackInLibrary(t),
                    compact: trackViewMode === 'compact',
                    onPress: () =>
                      player?.playFromContext(t.urn, sortedTrackUrns, {
                        context: { kind: 'local', label: '本地音乐' },
                      }),
                    onMore: (anchor) => menu.open({ track: t }, anchor),
                    onAddToFavorites: handleAddToFavorites,
                    onOpenPlaylistMenu: openAddToPlaylistMenu,
                    onOpenAlbum: handleOpenAlbum,
                  }),
              }),
        )
      : // 专辑模式：没有虚拟列表，滚动容器由本页自己提供，头部同样随内容滚走。
        h(
          'div',
          {
            key: 'album-scroll-container',
            ref: collapse.scrollerRef,
            style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' },
            onScroll: collapse.handleScroll,
          },
          stickyBar,
          headerNode,
          albumsContent,
        ),
    h(ContextMenu, menu.menuProps),
    h(SaveToPlaylistPopover, saveToPlaylistMenuProps),
    h(ContextMenu, {
      open: sortMenuAnchor !== null,
      onClose: () => setSortMenuAnchor(null),
      x: sortMenuAnchor?.x ?? 0,
      y: sortMenuAnchor?.y ?? 0,
      items:
        viewMode === 'tracks'
          ? viewModeMenuItems(trackSortMenuItems, trackViewMode, setTrackViewMode)
          : viewModeMenuItems(albumSortMenuItems, albumViewMode, setAlbumViewMode, {
              allowTiled: true,
            }),
      title: '排序方式',
    }),
  )
}
