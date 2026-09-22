/**
 * React DOM views for `@BBeBee/plugin-album`.
 *
 * One screen: the album header with its cover and "Play album", then the
 * track list. Every value comes from `@BBeBee/plugin-album/hooks` and
 * `ctx.sources`; this file is layout, gestures and event wiring only
 * (docs/08 §1).
 *
 * Playback semantics, which are the part worth stating:
 *
 *  - **"Play album"** is `playNow(urns)` — the explicit from-the-top gesture,
 *    and it replaces the queue outright. Disabled, not hidden, when the album
 *    has no playable tracks: an empty album is a real state, and hiding the
 *    control hides the reason.
 *  - **Tapping a row** is `playFromContext(track, albumUrns)`: jump if the
 *    queue already holds it, otherwise the whole album becomes the queue
 *    starting here. Playback never navigates; the transport bar announces it.
 */

import { createElement as h, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { DownloadsService, PlayerService, Track } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { useAlbum } from '@BBeBee/plugin-album/hooks'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { Artwork, ContextMenu, EmptyState, List } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import type { ArtworkProps, MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 *
 * A component rather than a bare hook call at the call site because the album
 * header is not a list row: the hook suppresses the remote URL while the cache
 * fetches, so the fallback paints instead of a second request.
 */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatTotalDuration(tracks: readonly { durationMs?: number }[]): string {
  const totalMs = tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0)
  if (totalMs <= 0) return ''
  const totalSeconds = Math.floor(totalMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  return `${minutes} 分钟 ${seconds} 秒`
}

function AlbumTrackTableRow({
  track,
  index,
  onPress,
  onDownload,
  onMore,
}: {
  track: Track
  index: number
  onPress: () => void
  onDownload?: () => void
  onMore: (anchor: { x: number; y: number }) => void
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
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault()
        onMore({ x: e.clientX, y: e.clientY })
      },
      onKeyDown: (e: React.KeyboardEvent) => {
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
    // Col 1: # or Play
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
      hovered ? '▶' : String(index + 1),
    ),
    // Col 2: Title and Artist
    h(
      'div',
      {
        style: {
          flex: 1,
          minWidth: 0,
          paddingLeft: 12,
          paddingRight: 16,
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
    // Col 3: Play count
    h(
      'div',
      {
        style: {
          width: 140,
          flexShrink: 0,
          textAlign: 'right',
          paddingRight: 24,
          fontSize: 14,
          color: '#b3b3b3',
        },
      },
      '-',
    ),
    // Col 4: Duration and actions
    h(
      'div',
      {
        style: {
          width: 110,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          paddingRight: 16,
        },
      },
      onDownload && !track.urn.startsWith('BBeBee:local:')
        ? h(
            'button',
            {
              type: 'button',
              'aria-label': 'Download',
              title: 'Download',
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation()
                onDownload()
              },
              style: {
                background: 'none',
                border: 'none',
                color: '#b3b3b3',
                fontSize: 15,
                cursor: 'pointer',
                padding: 4,
                opacity: hovered ? 1 : 0,
                transition: 'opacity 0.15s ease',
              },
            },
            '⬇',
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'More',
          title: 'More',
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          },
          style: {
            background: 'none',
            border: 'none',
            color: '#b3b3b3',
            fontSize: 16,
            cursor: 'pointer',
            padding: 4,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
          },
        },
        '⋯',
      ),
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
    ),
  )
}

/** What a screen shows while it does not yet have an answer. */
function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

type AlbumSortKey = 'trackNo' | 'title' | 'plays' | 'duration'

export function AlbumScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const album = useAlbum(ctx, urn)
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const menu = useTrackMenu(ctx)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const [sortKey, setSortKey] = useState<AlbumSortKey>('trackNo')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)

  const tracks = album.data?.tracks ?? []

  const sortedTracks = useMemo(() => {
    const list = [...tracks]
    if (sortKey === 'trackNo') {
      return sortOrder === 'desc' ? list.reverse() : list
    }
    list.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'duration') {
        cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
      } else if (sortKey === 'plays') {
        cmp = 0
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
    return list
  }, [tracks, sortKey, sortOrder])

  const sortedUrns = useMemo(() => sortedTracks.map((track) => track.urn), [sortedTracks])

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

  const handleHeaderClick = (key: AlbumSortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  const renderSortIndicator = (key: AlbumSortKey) => {
    if (sortKey !== key) return null
    return h('span', { style: { marginLeft: 4, fontSize: 11 } }, sortOrder === 'asc' ? '▲' : '▼')
  }

  const sortLabelMap: Record<AlbumSortKey, string> = {
    trackNo: '默认顺序',
    title: '标题',
    duration: '时长',
    plays: '播放量',
  }

  const sortMenuItems: MenuItemSpec[] = [
    {
      id: 'sort-trackNo',
      label: (sortKey === 'trackNo' ? '✓ ' : '    ') + '默认顺序',
      onSelect: () => setSortKey('trackNo'),
    },
    {
      id: 'sort-title',
      label: (sortKey === 'title' ? '✓ ' : '    ') + '标题',
      onSelect: () => setSortKey('title'),
    },
    {
      id: 'sort-duration',
      label: (sortKey === 'duration' ? '✓ ' : '    ') + '时长',
      onSelect: () => setSortKey('duration'),
    },
    {
      id: 'sort-plays',
      label: (sortKey === 'plays' ? '✓ ' : '    ') + '播放量',
      onSelect: () => setSortKey('plays'),
      divider: true,
    },
    {
      id: 'order-asc',
      label: (sortOrder === 'asc' ? '✓ ' : '    ') + '升序',
      onSelect: () => setSortOrder('asc'),
    },
    {
      id: 'order-desc',
      label: (sortOrder === 'desc' ? '✓ ' : '    ') + '降序',
      onSelect: () => setSortOrder('desc'),
    },
  ]

  const yearText = detail.year || (detail.releaseDate ? detail.releaseDate.slice(0, 4) : '')
  const totalDurationStr = formatTotalDuration(detail.tracks)

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'linear-gradient(180deg, #3d3d3d 0%, #1a1a1a 280px, #121212 100%)',
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
      h(
        'div',
        {
          style: {
            width: 232,
            height: 232,
            flexShrink: 0,
            borderRadius: 6,
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.65)',
          },
        },
        h(CachedArtwork, { ctx, artwork: detail.artwork, seed: detail.urn, size: 232, radius: 6 }),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 } },
        h(
          'span',
          { style: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#FFFFFF' } },
          '专辑',
        ),
        h(
          'h1',
          {
            style: {
              fontSize: detail.title.length > 25 ? 40 : 54,
              fontWeight: 900,
              margin: '2px 0 6px 0',
              lineHeight: 1.1,
              color: '#FFFFFF',
              letterSpacing: '-0.03em',
              wordBreak: 'break-word',
            },
          },
          detail.title,
        ),
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
            (detail.artists?.[0]?.name?.[0] || '♪').toUpperCase(),
          ),
          h('span', { style: { fontWeight: 700, color: '#FFFFFF' } }, detail.artists?.map((a) => a.name).join(', ') || '未知艺人'),
          yearText ? h('span', null, ` • ${yearText}`) : null,
          h('span', null, ` • ${detail.tracks.length} 首歌曲`),
          totalDurationStr ? h('span', null, `, ${totalDurationStr}`) : null,
        ),
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
            'aria-label': 'Play album',
            onClick: () => void player?.playNow(sortedUrns),
            disabled: detail.tracks.length === 0,
            style: {
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: detail.tracks.length === 0 ? 'rgba(30, 215, 96, 0.4)' : '#1ed760',
              border: 'none',
              cursor: detail.tracks.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 16px rgba(0, 0, 0, 0.3)',
              color: '#000000',
              fontSize: 22,
              paddingLeft: 4,
            },
          },
          h('span', null, '▶'),
          h(
            'span',
            {
              style: {
                position: 'absolute',
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: 'hidden',
                clip: 'rect(0, 0, 0, 0)',
                whiteSpace: 'nowrap',
                border: 0,
              },
            },
            'Play album',
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            title: '随机播放',
            style: { background: 'none', border: 'none', fontSize: 24, color: '#b3b3b3', cursor: 'pointer', padding: 0 },
            onClick: () => {
              if (sortedUrns.length > 0) {
                const shuffled = [...sortedUrns].sort(() => Math.random() - 0.5)
                void player?.playNow(shuffled)
              }
            },
          },
          '🔀',
        ),
        h(
          'button',
          {
            type: 'button',
            title: '添加到喜欢的音乐',
            style: { background: 'none', border: 'none', fontSize: 22, color: '#b3b3b3', cursor: 'pointer', padding: 0 },
          },
          '♡',
        ),
        downloads
          ? h(
              'button',
              {
                type: 'button',
                title: '下载全部',
                style: { background: 'none', border: 'none', fontSize: 22, color: '#b3b3b3', cursor: 'pointer', padding: 0 },
                onClick: () => void downloads.enqueue(sortedUrns),
              },
              '⬇',
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            title: '更多选项',
            style: { background: 'none', border: 'none', fontSize: 24, color: '#b3b3b3', cursor: 'pointer', padding: 0 },
            onClick: (e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              if (detail.tracks[0]) {
                menu.open({ track: detail.tracks[0] }, { x: rect.left, y: rect.bottom + 6 })
              }
            },
          },
          '⋯',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'album-sort-trigger',
            title: '排序方式',
            onClick: (e: React.MouseEvent) => {
              const rect = e.currentTarget.getBoundingClientRect()
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
          h('span', { style: { fontSize: 16 } }, '≣'),
        ),
      ),
    ),
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
          'data-testid': 'album-sort-trackNo',
          onClick: () => handleHeaderClick('trackNo'),
          style: {
            width: 40,
            textAlign: 'center',
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: sortKey === 'trackNo' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            padding: 0,
            fontSize: 13,
            fontWeight: 500,
          },
        },
        '#',
        renderSortIndicator('trackNo'),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'album-sort-title',
          onClick: () => handleHeaderClick('title'),
          style: {
            flex: 1,
            paddingLeft: 12,
            textAlign: 'left',
            background: 'none',
            border: 'none',
            color: sortKey === 'title' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            padding: 0,
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
          'data-testid': 'album-sort-plays',
          onClick: () => handleHeaderClick('plays'),
          style: {
            width: 140,
            textAlign: 'right',
            paddingRight: 24,
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: sortKey === 'plays' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            padding: 0,
            fontSize: 13,
            fontWeight: 500,
          },
        },
        '播放量',
        renderSortIndicator('plays'),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'album-sort-duration',
          onClick: () => handleHeaderClick('duration'),
          style: {
            width: 110,
            textAlign: 'right',
            paddingRight: 16,
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: sortKey === 'duration' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            padding: 0,
            fontSize: 13,
            fontWeight: 500,
          },
        },
        '🕒',
        renderSortIndicator('duration'),
      ),
    ),
    // Track list
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<Track>, {
        items: sortedTracks,
        accessibilityLabel: `Tracks on ${detail.title}`,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (track) => track.urn,
        empty: h(EmptyState, { title: 'This album has no tracks' }),
        renderItem: (track, index) =>
          h(AlbumTrackTableRow, {
            track,
            index,
            onPress: () => {
              void player?.playFromContext(track.urn, sortedUrns, {
                context: { kind: 'album', urn: detail.urn, label: detail.title },
              })
            },
            onDownload: downloads ? () => void downloads.enqueue([track.urn]) : undefined,
            onMore: (anchor) => menu.open({ track }, anchor),
          }),
      }),
    ),
    h(ContextMenu, menu.menuProps),
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

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-album-ui-desktop'

/**
 * `sources` is required (the album read goes through it); `player` and
 * `downloads` are read with `serviceOf`, so a build without either draws the
 * screen without the control that would call it.
 */
export const inject = ['ui', 'sources']

/**
 * Register a component bound to **this** context, not the shell's.
 *
 * The shell renders views with the context it was mounted on, and a Cordis
 * context throws for any property outside its inject list; every view package
 * closes over its own plugin context for exactly this reason (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-album-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(ALBUM_VIEWS.album, bound(ctx, AlbumScreen))
  }, 'album-ui-desktop')
}

export default { name, inject, apply }
