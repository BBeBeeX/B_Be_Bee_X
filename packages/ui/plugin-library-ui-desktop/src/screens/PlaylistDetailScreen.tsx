import { createElement as h, useMemo, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, KeyboardEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ArtworkRef, PlaylistItem, Track } from '@BBeBee/protocol'
import { usePlaylist } from '@BBeBee/plugin-library/hooks'
import { useTracksByUrn } from '@BBeBee/plugin-player/hooks'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { ContextMenu, EmptyState, List, SaveToPlaylistPopover, StickyDetailBar, Text, tablerIcon, useDetailBarCollapse, useImageColor, headerGradient, viewModeMenuItems, useViewMode } from '@BBeBee/ui-kit-desktop'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
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
  compact,
  inLibrary,
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
  /** 紧凑视图：无封面，艺人独立成列。 */
  compact?: boolean
  /** 实时收藏状态：在歌单里不等于已收藏，取消收藏要回到加号。 */
  inLibrary: boolean
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
        inLibrary,
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
            tablerIcon('x', { size: 20 }),
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
        tablerIcon('dots', { size: 20 }),
      ),
    ),
  )
}

type PlaylistSortKey = 'custom' | 'title' | 'artist' | 'album' | 'dateAdded' | 'duration'

/** 表头吸顶时停在吸顶栏正下方。 */
const BAR_HEIGHT = 64
/** 表头悬停时列间的发丝分隔线。 */
const HOVER_DIVIDER = 'inset 1px 0 0 rgba(255, 255, 255, 0.08)'

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
  // 视图模式：列表为默认（与历史行为一致），紧凑不显示封面并把艺人单列。
  const [viewMode, setViewMode] = useViewMode('playlist-detail', 'list', ['compact', 'list'] as const)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)
  const [headerHovered, setHeaderHovered] = useState(false)
  // 滚动折叠：吸顶栏在播放按钮靠近时从视口上方滑入，滚过按钮一半高度时
  // 把按钮“吸”进吸顶栏（docked），表头吸附在吸顶栏正下方。
  const collapse = useDetailBarCollapse({ barHeight: BAR_HEIGHT, anchorHeight: 56 })
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })
  const { isTrackInLibrary, openAddToPlaylistMenu, saveToPlaylistMenuProps } = useTrackLibraryInfo(ctx)

  // 背景与吸顶栏的主题色：优先歌单封面，其次第一首歌的封面。
  const coverArtwork: ArtworkRef | undefined =
    detail?.artwork ?? tracks.get(rawItems[0]?.trackUrn ?? '')?.artwork
  const resolvedCover = useResolvedArtwork(ctx, coverArtwork)
  const tint = useImageColor(resolvedCover?.sourceUrl, resolvedCover?.dominantColor)

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
    // 表头默认不带箭头；悬停时当前排序列显示方向箭头，其余列显示浅色提示。
    if (!headerHovered) return null
    if (sortKey === key) {
      return sortOrder === 'asc'
        ? tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4 } })
        : tablerIcon('chevron-down', { size: 16, style: { marginLeft: 4 } })
    }
    return tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4, opacity: 0.35 } })
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
      icon: sortKey === 'custom' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('custom'),
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
      id: 'sort-dateAdded',
      label: '添加日期',
      icon: sortKey === 'dateAdded' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('dateAdded'),
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

  const totalDurationStr = formatTotalDuration(Array.from(tracks.values()))

  const renderPlayButton = (size: number, iconSize: number, testID: string | undefined) =>
    h(
      'button',
      {
        type: 'button',
        'data-testid': testID,
        'aria-label': 'Play',
        onClick: () => sortedUrns[0] && play(sortedUrns[0]),
        disabled: sortedUrns.length === 0,
        style: {
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
          border: 'none',
          cursor: sortedUrns.length === 0 ? 'not-allowed' : 'pointer',
          opacity: sortedUrns.length === 0 ? 0.5 : 1,
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

  // 随列表一起滚走的部分：封面 hero、操作条、胶囊按钮、表头。
  // 吸顶栏单独走 List 的 sticky 插槽（滚动容器的直接子节点）。
  const stickyBar = h(StickyDetailBar, {
    title: detail.name,
    progress: collapse.slide,
    docked: collapse.docked,
    tint,
    playButton: renderPlayButton(48, 24, 'playlist-play-sticky'),
  })

  // 渐变只存在于头部区域（随内容滚走），到底边精确过渡为纯色；下方内容
  // 与吸附后的表头都是纯色 --bg-primary。
  const headerNode = h(
    'div',
    { style: { background: headerGradient(tint) } },
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
              // 超长标题最多两行，超出省略——不撑破布局。
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
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
        // 折叠锚点：吸顶栏按这只大按钮的位置决定滑入与吸附时机。
        h('div', { ref: collapse.anchorRef, style: { display: 'flex' } }, renderPlayButton(56, 28, 'playlist-play')),
        h(
          'button',
          {
            type: 'button',
            title: '下载',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
          },
          tablerIcon('download', { size: 24 }),
        ),
        h(
          'button',
          {
            type: 'button',
            title: '更多选项',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
          },
          tablerIcon('dots', { size: 24 }),
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
          tablerIcon('list', { size: 20 }),
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
        tablerIcon('playlist-add', { size: 18 }),
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
        tablerIcon('pencil', { size: 18 }),
        '名称和详情',
      ),
    ),
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
  )

  // 表头走 stickyHeader 插槽（滚动容器的直接子节点）——嵌在 header 盒内时
  // sticky 只在父盒范围吸附，作为父盒最后一个子元素等于完全吸不住。
  const tableHeaderNode = h(
    'div',
    {
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
            boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
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
            boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
          },
        },
        '标题',
        renderSortIndicator('title'),
      ),
      viewMode === 'compact'
        ? h(
            'div',
            {
              key: 'playlist-header-artist',
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
            boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
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
            boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
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
            boxShadow: headerHovered ? HOVER_DIVIDER : undefined,
          },
        },
        tablerIcon('clock', { size: 18 }),
        renderSortIndicator('duration'),
      ),
    )

  return h(
    'section',
    {
      'aria-label': detail.name,
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary, #080A10)',
        color: '#FFFFFF',
        overflow: 'hidden',
      },
    },
    // Track Rows — the header scrolls away inside the same scroller, and the
    // sticky bar rides on top of it.
    h(
      'div',
      { ref: collapse.scrollerRef, style: { flex: 1, minHeight: 0 } },
      h(List<{ item: PlaylistItem; trackUrn: string; track?: Track; originalIndex: number }>, {
        testID: 'playlist-tracks',
        header: headerNode,
        sticky: stickyBar,
        stickyHeader: tableHeaderNode,
        onScroll: collapse.handleScroll,
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
            compact: viewMode === 'compact',
            onPress: () => play(trackUrn),
            // 取消收藏后那一行要回到加号：心形状态跟着实时收藏集合走。
            inLibrary: isTrackInLibrary(track),
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
      items: viewModeMenuItems(sortMenuItems, viewMode, setViewMode),
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
