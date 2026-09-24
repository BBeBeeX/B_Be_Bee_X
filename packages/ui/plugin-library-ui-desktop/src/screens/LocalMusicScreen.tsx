import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Album, PlayerService, Track } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { serviceOf, type MenuAnchor, type MenuItemSpec } from '@BBeBee/ui-core'
import { ContextMenu, EmptyState, List, SaveToPlaylistPopover, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
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
  onPress,
  onMore,
  onAddToFavorites,
  onOpenPlaylistMenu,
}: {
  ctx: Context
  track: Track
  index: number
  inLibrary: boolean
  onPress: () => void
  onMore: (anchor: { x: number; y: number }) => void
  onAddToFavorites?: (track: Track) => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
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
    // Col 2: Artwork + Title + Artist
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
      h(
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
        artists
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
      track.albumTitle || '-',
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
    if (trackSortKey !== key) return null
    return trackSortOrder === 'asc'
      ? tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4 } })
      : tablerIcon('chevron-down', { size: 16, style: { marginLeft: 4 } })
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

  return h(
    'section',
    {
      'aria-label': '本地音乐',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'linear-gradient(180deg, #3d1c47 0%, #1c0d21 280px, #121212 100%)',
        color: '#FFFFFF',
        overflow: 'hidden',
      },
    },
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
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'local-music-play',
            'aria-label': '播放全部',
            onClick: () => sortedTrackUrns[0] && player?.playNow(sortedTrackUrns),
            disabled: sortedTrackUrns.length === 0,
            style: {
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: sortedTrackUrns.length === 0 ? 'var(--surface-active, rgba(99, 102, 241, 0.4))' : 'var(--primary, #6366F1)',
              border: 'none',
              cursor: sortedTrackUrns.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--glow-sm, 0 8px 16px rgba(0, 0, 0, 0.3))',
              color: '#ffffff',
              paddingLeft: 2,
            },
          },
          tablerIcon('play', { size: 28, color: '#ffffff' }),
        ),
        h(
          'button',
          {
            type: 'button',
            title: '随机播放',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: () => {
              if (sortedTrackUrns.length > 0) {
                const shuffled = [...sortedTrackUrns].sort(() => Math.random() - 0.5)
                void player?.playNow(shuffled)
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
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
    // Content based on viewMode
    viewMode === 'tracks'
      ? [
          // Table Header
          h(
            'div',
            {
              key: 'track-table-header',
              style: {
                display: 'flex',
                alignItems: 'center',
                padding: '0 32px 8px 32px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#b3b3b3',
                fontSize: 13,
                fontWeight: 500,
                flexShrink: 0,
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
                },
              },
              '标题',
              renderTrackSortIndicator('title'),
            ),
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
                },
              },
              tablerIcon('clock', { size: 18 }),
              renderTrackSortIndicator('duration'),
            ),
          ),
          loading
            ? h(EmptyState, { key: 'track-loading', title: '加载中…' })
            : sortedTracks.length === 0
            ? h(EmptyState, {
                key: 'track-empty',
                icon: 'folder',
                title: '暂无本地音乐',
                description: '添加音乐文件夹后，扫描的歌曲将在此显示。',
              })
            : h(
                'div',
                { key: 'track-list-container', style: { flex: 1, minHeight: 0 } },
                h(List<Track>, {
                  testID: 'local-tracks-list',
                  items: sortedTracks,
                  estimatedItemSize: tokens.size.row,
                  keyExtractor: (t) => t.urn,
                  renderItem: (t, index) =>
                    h(LocalTrackTableRow, {
                      ctx,
                      track: t,
                      index,
                      inLibrary: isTrackInLibrary(t),
                      onPress: () => player?.playFromContext(t.urn, sortedTrackUrns),
                      onMore: (anchor) => menu.open({ track: t }, anchor),
                      onAddToFavorites: handleAddToFavorites,
                      onOpenPlaylistMenu: openAddToPlaylistMenu,
                    }),
                }),
              ),
        ]
      : [
          // Albums Grid
          loading
            ? h(EmptyState, { key: 'album-loading', title: '加载中…' })
            : sortedAlbums.length === 0
            ? h(EmptyState, {
                key: 'album-empty',
                icon: 'disc',
                title: '暂无本地专辑',
                description: '添加包含专辑信息的本地音乐文件夹后，专辑将在此显示。',
              })
            : h(
                'div',
                {
                  key: 'album-grid-container',
                  style: {
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
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
                          void player?.playNow(urns)
                        }
                      },
                    }),
                  ),
                ),
              ),
        ],
    h(ContextMenu, menu.menuProps),
    h(SaveToPlaylistPopover, saveToPlaylistMenuProps),
    h(ContextMenu, {
      open: sortMenuAnchor !== null,
      onClose: () => setSortMenuAnchor(null),
      x: sortMenuAnchor?.x ?? 0,
      y: sortMenuAnchor?.y ?? 0,
      items: viewMode === 'tracks' ? trackSortMenuItems : albumSortMenuItems,
      title: '排序方式',
    }),
  )
}
