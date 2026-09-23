import { createElement as h, useMemo, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, KeyboardEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PlaylistItem, Track } from '@BBeBee/protocol'
import { usePlaylist } from '@BBeBee/plugin-library/hooks'
import { useTracksByUrn } from '@BBeBee/plugin-player/hooks'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { ContextMenu, EmptyState, List, SaveToPlaylistPopover, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork } from '../components/CachedArtwork.js'
import { QuadArtworkCollage } from '../components/QuadArtworkCollage.js'
import { TrackLibraryActionButton } from '../components/TrackLibraryActionButton.js'
import { EditPlaylistModal } from '../components/modals/EditPlaylistModal.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'
import { formatAddedDate, formatDuration, formatTotalDuration } from '../utils/data-helpers.js'

function PlaylistTrackTableRow({
  ctx,
  track,
  item,
  index,
  isSmart,
  playlistName,
  onPress,
  onRemove,
  onMore,
  onOpenPlaylistMenu,
}: {
  ctx: Context
  track: Track
  item: PlaylistItem
  index: number
  isSmart?: boolean
  playlistName: string
  onPress: () => void
  onRemove?: () => void
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
      hovered ? tablerIcon('play', { size: 14, color: '#FFFFFF' }) : String(index + 1),
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
          : tablerIcon('music', { size: 18, color: '#7f7f7f' }),
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
    // Col 4: Added date
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
      formatAddedDate(item.addedAt),
    ),
    // Col 5: Duration & actions
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
      !isSmart && onRemove
        ? h(
            'button',
            {
              type: 'button',
              'aria-label': `Remove ${track.title} from ${playlistName}`,
              title: `Remove from ${playlistName}`,
              onClick: (e: ReactMouseEvent) => {
                e.stopPropagation()
                onRemove()
              },
              style: {
                background: 'none',
                border: 'none',
                color: '#b3b3b3',
                cursor: 'pointer',
                padding: '2px 4px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: hovered ? 1 : 0,
                transition: 'opacity 0.15s ease',
              },
            },
            tablerIcon('x', { size: 16 }),
          )
        : null,
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
        tablerIcon('dots', { size: 16 }),
      ),
    ),
  )
}

type PlaylistSortKey = 'custom' | 'title' | 'artist' | 'album' | 'dateAdded' | 'duration'

export function PlaylistDetailScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const state = usePlaylist(ctx, urn)
  const detail = state.data
  const rawItems = detail?.items ?? []
  const urns = rawItems.map((item) => item.trackUrn)
  const tracks = useTracksByUrn(ctx, urns)
  const [error, setError] = useState<string | undefined>(undefined)
  const [showEditModal, setShowEditModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<PlaylistSortKey>('custom')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })
  const { openAddToPlaylistMenu, saveToPlaylistMenuProps } = useTrackLibraryInfo(ctx)

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const list = rawItems.map((item, originalIndex) => ({
      item,
      trackUrn: item.trackUrn,
      track: tracks.get(item.trackUrn),
      originalIndex,
    }))

    const matching = q
      ? list.filter(({ track, trackUrn }) => {
          if (!track) return trackUrn.toLowerCase().includes(q)
          return (
            track.title.toLowerCase().includes(q) ||
            track.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
            track.albumTitle?.toLowerCase().includes(q)
          )
        })
      : list

    if (sortKey === 'custom') {
      return sortOrder === 'desc' ? [...matching].reverse() : matching
    }

    return [...matching].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'title') {
        cmp = (a.track?.title ?? '').localeCompare(b.track?.title ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (sortKey === 'artist') {
        const aArt = a.track?.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.track?.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'album') {
        cmp = (a.track?.albumTitle ?? '').localeCompare(b.track?.albumTitle ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (sortKey === 'dateAdded') {
        cmp = (a.item.addedAt ?? 0) - (b.item.addedAt ?? 0)
      } else if (sortKey === 'duration') {
        cmp = (a.track?.durationMs ?? 0) - (b.track?.durationMs ?? 0)
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
  }, [rawItems, tracks, searchQuery, sortKey, sortOrder])

  const sortedUrns = useMemo(() => filteredRows.map((r) => r.trackUrn), [filteredRows])

  const play = (trackUrn: string) => {
    if (!detail) return
    void ctx.player.playFromContext(trackUrn, sortedUrns, {
      context: { kind: 'playlist', urn: detail.urn, label: detail.name },
    })
  }

  if (!urn) return h(EmptyState, { title: 'No playlist chosen' })
  if (state.status === 'error') {
    return h(EmptyState, { title: 'Could not open the playlist', description: state.error?.message })
  }
  if (!detail) return h(EmptyState, { title: 'Loading…' })

  const handleHeaderClick = (key: PlaylistSortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  const renderSortIndicator = (key: PlaylistSortKey) => {
    if (sortKey !== key) return null
    return sortOrder === 'asc'
      ? tablerIcon('chevron-up', { size: 12, style: { marginLeft: 4 } })
      : tablerIcon('chevron-down', { size: 12, style: { marginLeft: 4 } })
  }

  const sortLabelMap: Record<PlaylistSortKey, string> = {
    custom: '自定义顺序',
    title: '标题',
    artist: '艺人',
    album: '专辑',
    dateAdded: '添加日期',
    duration: '时长',
  }

  const sortMenuItems: MenuItemSpec[] = [
    {
      id: 'sort-custom',
      label: '自定义顺序',
      icon: sortKey === 'custom' ? tablerIcon('check', { size: 14 }) : undefined,
      onSelect: () => setSortKey('custom'),
    },
    {
      id: 'sort-title',
      label: '标题',
      icon: sortKey === 'title' ? tablerIcon('check', { size: 14 }) : undefined,
      onSelect: () => setSortKey('title'),
    },
    {
      id: 'sort-artist',
      label: '艺人',
      icon: sortKey === 'artist' ? tablerIcon('check', { size: 14 }) : undefined,
      onSelect: () => setSortKey('artist'),
    },
    {
      id: 'sort-album',
      label: '专辑',
      icon: sortKey === 'album' ? tablerIcon('check', { size: 14 }) : undefined,
      onSelect: () => setSortKey('album'),
    },
    {
      id: 'sort-dateAdded',
      label: '添加日期',
      icon: sortKey === 'dateAdded' ? tablerIcon('check', { size: 14 }) : undefined,
      onSelect: () => setSortKey('dateAdded'),
    },
    {
      id: 'sort-duration',
      label: '时长',
      icon: sortKey === 'duration' ? tablerIcon('check', { size: 14 }) : undefined,
      onSelect: () => setSortKey('duration'),
      divider: true,
    },
    {
      id: 'order-asc',
      label: '升序',
      icon: sortOrder === 'asc' ? tablerIcon('check', { size: 14 }) : undefined,
      onSelect: () => setSortOrder('asc'),
    },
    {
      id: 'order-desc',
      label: '降序',
      icon: sortOrder === 'desc' ? tablerIcon('check', { size: 14 }) : undefined,
      onSelect: () => setSortOrder('desc'),
    },
  ]

  const totalDurationStr = formatTotalDuration(Array.from(tracks.values()))

  return h(
    'section',
    {
      'aria-label': detail.name,
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'linear-gradient(180deg, #1e3264 0%, #151f38 280px, #121212 100%)',
        color: '#FFFFFF',
        overflow: 'hidden',
      },
    },
    // Hero Header
    h(
      'header',
      {
        style: {
          display: 'flex',
          gap: 24,
          padding: '36px 32px 24px 32px',
          alignItems: 'flex-end',
          flexShrink: 0,
        },
      },
      h(QuadArtworkCollage, {
        ctx,
        tracks: Array.from(tracks.values()),
        customArtwork: detail.artwork,
        size: 232,
        radius: 6,
        onEdit: () => setShowEditModal(true),
      }),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 } },
        h(
          'span',
          { style: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#FFFFFF' } },
          detail.isPublic !== false ? '公开歌单' : '歌单',
        ),
        h(
          'h1',
          {
            onClick: () => setShowEditModal(true),
            title: '点击编辑详情',
            style: {
              fontSize: detail.name.length > 20 ? 40 : 54,
              fontWeight: 900,
              margin: '2px 0 6px 0',
              lineHeight: 1.1,
              color: '#FFFFFF',
              letterSpacing: '-0.03em',
              cursor: 'pointer',
              wordBreak: 'break-word',
            },
          },
          detail.name,
        ),
        detail.description
          ? h('p', { style: { margin: '0 0 4px 0', fontSize: 14, color: '#b3b3b3' } }, detail.description)
          : null,
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 6,
              fontSize: 14,
              color: '#b3b3b3',
              marginTop: 4,
            },
          },
          h(
            'div',
            {
              style: {
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: '#404040',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              },
            },
            (detail.owner?.[0] || 'B').toUpperCase(),
          ),
          h('span', { style: { fontWeight: 700, color: '#FFFFFF' } }, detail.owner || 'BBeBee'),
          h('span', null, ` • ${detail.isSmart ? '智能歌单' : `${detail.trackCount ?? urns.length} 首歌曲`}`),
          totalDurationStr ? h('span', null, `, ${totalDurationStr}`) : null,
        ),
      ),
    ),
    // Primary Action Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px 14px 32px',
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
            'data-testid': 'playlist-play',
            'aria-label': 'Play',
            onClick: () => sortedUrns[0] && play(sortedUrns[0]),
            disabled: sortedUrns.length === 0,
            style: {
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: sortedUrns.length === 0 ? 'rgba(30, 215, 96, 0.4)' : '#1ed760',
              border: 'none',
              cursor: sortedUrns.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 16px rgba(0, 0, 0, 0.3)',
              color: '#000000',
              paddingLeft: 2,
            },
          },
          tablerIcon('play', { size: 24, color: '#000000' }),
        ),
        h(
          'button',
          {
            type: 'button',
            title: '下载',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
          },
          tablerIcon('download', { size: 20 }),
        ),
        h(
          'button',
          {
            type: 'button',
            title: '更多选项',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
          },
          tablerIcon('dots', { size: 20 }),
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
          tablerIcon('search', { size: 14, color: '#b3b3b3' }),
          h('input', {
            type: 'text',
            placeholder: '在歌单中搜索',
            value: searchQuery,
            onChange: (e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value),
            style: {
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#FFFFFF',
              fontSize: 13,
              width: 120,
            },
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'playlist-sort-trigger',
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
          tablerIcon('list', { size: 16 }),
        ),
      ),
    ),
    // Secondary Actions (Capsule Buttons)
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 32px 16px 32px',
          flexShrink: 0,
        },
      },
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            const el = document.querySelector('input[placeholder="在歌单中搜索"]') as HTMLInputElement | null
            el?.focus()
          },
          style: {
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 20,
            padding: '6px 16px',
            color: '#FFFFFF',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          },
        },
        tablerIcon('plus', { size: 14 }),
        '添加',
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () => setShowEditModal(true),
          style: {
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 20,
            padding: '6px 16px',
            color: '#FFFFFF',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          },
        },
        tablerIcon('pencil', { size: 14 }),
        '名称和详情',
      ),
    ),
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
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
          'data-testid': 'playlist-sort-custom',
          onClick: () => handleHeaderClick('custom'),
          style: {
            width: 40,
            textAlign: 'center',
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: sortKey === 'custom' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            padding: 0,
            fontSize: 13,
            fontWeight: 500,
          },
        },
        '#',
        renderSortIndicator('custom'),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'playlist-sort-title',
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
          'data-testid': 'playlist-sort-album',
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
          'data-testid': 'playlist-sort-dateAdded',
          onClick: () => handleHeaderClick('dateAdded'),
          style: {
            flex: 1,
            paddingLeft: 8,
            textAlign: 'left',
            background: 'none',
            border: 'none',
            color: sortKey === 'dateAdded' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          },
        },
        '添加日期',
        renderSortIndicator('dateAdded'),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'playlist-sort-duration',
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
        tablerIcon('clock', { size: 14 }),
        renderSortIndicator('duration'),
      ),
    ),
    // Track Rows
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<{ item: PlaylistItem; trackUrn: string; track?: Track; originalIndex: number }>, {
        testID: 'playlist-tracks',
        items: filteredRows,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (row) => row.item.id,
        empty: h(EmptyState, {
          icon: 'music',
          title: 'Nothing here yet',
          description: detail.isSmart
            ? 'No track in the catalogue matches this playlist\'s rules right now.'
            : 'Add tracks from the library to fill this playlist.',
        }),
        renderItem: (row, index) => {
          const { track, item, trackUrn } = row
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, trackUrn)
          return h(PlaylistTrackTableRow, {
            ctx,
            track,
            item,
            index,
            isSmart: detail.isSmart,
            playlistName: detail.name,
            onPress: () => play(trackUrn),
            onRemove: () => {
              setError(undefined)
              void ctx.library.removeItems(detail.urn, [item.id]).catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
            },
            onMore: (anchor) => menu.open({ track, playlistItemId: item.id }, anchor),
            onOpenPlaylistMenu: openAddToPlaylistMenu,
          })
        },
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
    showEditModal
      ? h(EditPlaylistModal, {
          playlist: detail,
          onClose: () => setShowEditModal(false),
          onSave: async (patch) => {
            await ctx.library.updatePlaylist(detail.urn, patch)
            setShowEditModal(false)
          },
        })
      : null,
  )
}
