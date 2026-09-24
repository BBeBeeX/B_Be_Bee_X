import { createElement as h, useMemo, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PlayerService, Track } from '@BBeBee/protocol'
import { useSaved } from '@BBeBee/plugin-library/hooks'
import { useTracksByUrn } from '@BBeBee/plugin-player/hooks'
import { serviceOf, type MenuAnchor, type MenuItemSpec } from '@BBeBee/ui-core'
import { ContextMenu, EmptyState, List, SaveToPlaylistPopover, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork } from '../components/CachedArtwork.js'
import { TrackLibraryActionButton } from '../components/TrackLibraryActionButton.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'
import { formatDuration } from '../utils/data-helpers.js'

function FavoriteTrackTableRow({
  ctx,
  track,
  index,
  onPress,
  onMore,
  onOpenPlaylistMenu,
}: {
  ctx: Context
  track: Track
  index: number
  onPress: () => void
  onMore: (anchor: { x: number; y: number }) => void
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
      h(CachedArtwork, { ctx, artwork: track.artwork, seed: track.urn, size: 40, radius: 4 }),
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: 0,
            overflow: 'hidden',
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
    // Col 4: Action icon + Duration & More
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
        inLibrary: true,
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

type FavoriteSortKey = 'default' | 'title' | 'artist' | 'album' | 'duration'

export function FavoritesScreen({ ctx }: { ctx: Context }): ReactElement {
  const saved = useSaved(ctx, 'track')
  const entries = saved.data ?? []
  const urns = useMemo(() => entries.map((entry) => entry.urn), [entries])
  const tracksMap = useTracksByUrn(ctx, urns)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const error = saved.error?.message
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<FavoriteSortKey>('default')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)
  const menu = useTrackMenu(ctx)
  const { openAddToPlaylistMenu, saveToPlaylistMenuProps } = useTrackLibraryInfo(ctx)

  const allTracks = useMemo(() => {
    return urns.map((urn) => tracksMap.get(urn) ?? { urn, title: urn.split(':').pop() ?? urn, artists: [] })
  }, [urns, tracksMap])

  const sortedTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matching = q
      ? allTracks.filter((t) => {
          return (
            t.title.toLowerCase().includes(q) ||
            t.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
            t.albumTitle?.toLowerCase().includes(q)
          )
        })
      : [...allTracks]

    if (sortKey === 'default') {
      return sortOrder === 'desc' ? matching.reverse() : matching
    }

    return matching.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'artist') {
        const aArt = a.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'album') {
        cmp = (a.albumTitle ?? '').localeCompare(b.albumTitle ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (sortKey === 'duration') {
        cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
  }, [allTracks, searchQuery, sortKey, sortOrder])

  const sortedUrns = useMemo(() => sortedTracks.map((t) => t.urn), [sortedTracks])

  const handleHeaderClick = (key: FavoriteSortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  const renderSortIndicator = (key: FavoriteSortKey) => {
    if (sortKey !== key) return null
    return sortOrder === 'asc'
      ? tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4 } })
      : tablerIcon('chevron-down', { size: 16, style: { marginLeft: 4 } })
  }

  const sortLabelMap: Record<FavoriteSortKey, string> = {
    default: '默认顺序',
    title: '标题',
    artist: '艺人',
    album: '专辑',
    duration: '时长',
  }

  const sortMenuItems: MenuItemSpec[] = [
    {
      id: 'sort-default',
      label: '默认顺序',
      icon: sortKey === 'default' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('default'),
    },
    {
      id: 'sort-title',
      label: '标题',
      icon: sortKey === 'title' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('title'),
    },
    {
      id: 'sort-artist',
      label: '艺人',
      icon: sortKey === 'artist' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('artist'),
    },
    {
      id: 'sort-album',
      label: '专辑',
      icon: sortKey === 'album' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('album'),
    },
    {
      id: 'sort-duration',
      label: '时长',
      icon: sortKey === 'duration' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('duration'),
      divider: true,
    },
    {
      id: 'order-asc',
      label: '升序',
      icon: sortOrder === 'asc' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortOrder('asc'),
    },
    {
      id: 'order-desc',
      label: '降序',
      icon: sortOrder === 'desc' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortOrder('desc'),
    },
  ]

  return h(
    'section',
    {
      'aria-label': '已点赞的歌曲',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'linear-gradient(180deg, var(--surface-selected, rgba(95, 135, 255, 0.2)) 0%, var(--surface-1, rgba(8, 13, 26, 0.7)) 280px, var(--bg-primary, #080A10) 100%)',
        color: '#FFFFFF',
        overflow: 'hidden',
      },
    },
    // Hero Header (No Cover, exactly matching LocalMusicScreen)
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
        {
          style: {
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#FFFFFF',
          },
        },
        '歌单',
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
        '已点赞的歌曲',
      ),
      h(
        'p',
        { style: { margin: 0, fontSize: 14, color: '#b3b3b3' } },
        `已收藏的音乐 • ${urns.length} 首歌曲`,
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
            'data-testid': 'favorites-play',
            'aria-label': '播放全部',
            onClick: () => sortedUrns[0] && player?.playFromContext(sortedUrns[0], sortedUrns),
            disabled: sortedUrns.length === 0,
            style: {
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: sortedUrns.length === 0 ? 'var(--surface-active, rgba(95, 135, 255, 0.3))' : 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
              border: 'none',
              cursor: sortedUrns.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--glow-brand-md, 0 8px 16px rgba(0, 0, 0, 0.3))',
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
              if (sortedUrns.length > 0) {
                const shuffled = [...sortedUrns].sort(() => Math.random() - 0.5)
                if (shuffled[0]) void player?.playFromContext(shuffled[0], shuffled)
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
            placeholder: '在已点赞歌曲中搜索',
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
            'data-testid': 'favorites-sort-trigger',
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
          h('span', null, sortLabelMap[sortKey]),
          tablerIcon('list', { size: 20 }),
        ),
      ),
    ),
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
    saved.status === 'error'
      ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { tone: 'error' }, `Could not read favourites: ${saved.error?.message}`))
      : null,
    // Table Header
    h(
      'div',
      {
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
          'data-testid': 'favorites-sort-default',
          onClick: () => handleHeaderClick('default'),
          style: {
            width: 40,
            textAlign: 'center',
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: sortKey === 'default' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            padding: 0,
            fontSize: 13,
            fontWeight: 500,
          },
        },
        '#',
        renderSortIndicator('default'),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'favorites-sort-title',
          onClick: () => handleHeaderClick('title'),
          style: {
            flex: 2,
            paddingLeft: 12,
            textAlign: 'left',
            background: 'none',
            border: 'none',
            color: sortKey === 'title' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          },
        },
        '标题',
        renderSortIndicator('title'),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'favorites-sort-album',
          onClick: () => handleHeaderClick('album'),
          style: {
            flex: 1.5,
            paddingLeft: 8,
            textAlign: 'left',
            background: 'none',
            border: 'none',
            color: sortKey === 'album' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          },
        },
        '专辑',
        renderSortIndicator('album'),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'favorites-sort-duration',
          onClick: () => handleHeaderClick('duration'),
          style: {
            width: 120,
            textAlign: 'right',
            paddingRight: 40,
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: sortKey === 'duration' ? '#FFFFFF' : '#b3b3b3',
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
        renderSortIndicator('duration'),
      ),
    ),
    // Content / List
    saved.status === 'loading'
      ? h(EmptyState, { title: '加载中…' })
      : sortedTracks.length === 0
      ? h(EmptyState, {
          icon: 'heart',
          title: '暂无已点赞歌曲',
          description: '在曲库中收藏歌曲后，歌曲将在此显示。',
        })
      : h(
          'div',
          { style: { flex: 1, minHeight: 0 } },
          h(List<Track>, {
            testID: 'favorites-list',
            items: sortedTracks,
            estimatedItemSize: tokens.size.row,
            keyExtractor: (t) => t.urn,
            renderItem: (t, index) =>
              h(FavoriteTrackTableRow, {
                ctx,
                track: t,
                index,
                onPress: () => player?.playFromContext(t.urn, sortedUrns),
                onMore: (anchor) => menu.open({ track: t }, anchor),
                onOpenPlaylistMenu: openAddToPlaylistMenu,
              }),
          }),
        ),
    h(ContextMenu, menu.menuProps),
    h(SaveToPlaylistPopover, saveToPlaylistMenuProps),
    h(ContextMenu, {
      open: sortMenuAnchor !== null,
      onClose: () => setSortMenuAnchor(null),
      x: sortMenuAnchor?.x ?? 0,
      y: sortMenuAnchor?.y ?? 0,
      items: sortMenuItems,
      title: '排序方式',
    }),
  )
}
