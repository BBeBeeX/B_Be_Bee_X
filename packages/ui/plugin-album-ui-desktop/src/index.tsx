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

import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Collection, DownloadsService, LibraryService, PlayerService, SleepTimerService, SourcesService, Track } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { useAlbum } from '@BBeBee/plugin-album/hooks'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { formatDuration, formatTotalDuration } from '@BBeBee/toolkit'
import { addToCollectionSubmenu, sleepTimerSubmenu, useSaveToPlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'
import { Artwork, ContextMenu, EmptyState, List, SaveToPlaylistPopover, tablerIcon } from '@BBeBee/ui-kit-desktop'
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

function TrackLibraryActionButton({
  track,
  hovered,
  inLibrary: initialInLibrary,
  onAddToFavorites,
  onOpenPlaylistMenu,
}: {
  track: Track
  hovered: boolean
  inLibrary: boolean
  onAddToFavorites?: () => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
}): ReactElement {
  const [optimisticInLibrary, setOptimisticInLibrary] = useState(false)
  const inLibrary = initialInLibrary || optimisticInLibrary

  return h(
    'button',
    {
      type: 'button',
      'aria-label': inLibrary ? `Add ${track.title} to playlist` : `Add ${track.title} to favourites`,
      title: inLibrary ? '加入歌单' : '加入最喜欢的音乐',
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation()
        if (inLibrary) {
          const rect = e.currentTarget.getBoundingClientRect()
          onOpenPlaylistMenu(track, { x: rect.left, y: rect.bottom + 4 })
        } else {
          setOptimisticInLibrary(true)
          onAddToFavorites?.()
        }
      },
      style: {
        background: 'none',
        border: 'none',
        color: inLibrary ? 'var(--color-primary, #5F87FF)' : 'var(--text-tertiary, #8B95B0)',
        fontSize: inLibrary ? 16 : 18,
        fontWeight: inLibrary ? 700 : 400,
        cursor: 'pointer',
        padding: '2px 4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.15s ease',
      },
    },
    inLibrary ? tablerIcon('heart-filled', { size: 20 }) : tablerIcon('plus', { size: 20 }),
  )
}

function AlbumTrackTableRow({
  track,
  index,
  albumTitle,
  inLibrary,
  onAddToFavorites,
  onOpenPlaylistMenu,
  onPress,
  onDownload,
  onMore,
}: {
  track: Track
  index: number
  albumTitle?: string
  inLibrary: boolean
  onAddToFavorites?: (track: Track) => void
  onOpenPlaylistMenu?: (track: Track, anchor: MenuAnchor) => void
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
      hovered ? tablerIcon('play', { size: 18 }) : String(index + 1),
    ),
    // Col 2: Title and Artist
    h(
      'div',
      {
        style: {
          flex: 2,
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
      track.albumTitle || albumTitle || '-',
    ),
    // Col 4: Duration and actions
    h(
      'div',
      {
        style: {
          width: 130,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
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
            tablerIcon('download', { size: 20 }),
          )
        : null,
      onOpenPlaylistMenu
        ? h(TrackLibraryActionButton, {
            track,
            hovered,
            inLibrary,
            onAddToFavorites: () => onAddToFavorites?.(track),
            onOpenPlaylistMenu,
          })
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
        tablerIcon('dots', { size: 20 }),
      ),
    ),
  )
}

/** What a screen shows while it does not yet have an answer. */
function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

type AlbumSortKey = 'trackNo' | 'title' | 'album' | 'duration' | 'plays'

export function AlbumScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const album = useAlbum(ctx, urn)
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const library = serviceOf<LibraryService>(ctx, 'library')
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const sleepTimer = serviceOf<SleepTimerService>(ctx, 'sleepTimer')
  const menu = useTrackMenu(ctx)
  const saveToPlaylistMenu = useSaveToPlaylistMenu(ctx)
  const [sortKey, setSortKey] = useState<AlbumSortKey>('trackNo')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)
  const [albumMenuAnchor, setAlbumMenuAnchor] = useState<MenuAnchor | null>(null)
  const [collections, setCollections] = useState<readonly Collection[]>([])
  const [isSaved, setIsSaved] = useState(false)
  const [savedTrackUrns, setSavedTrackUrns] = useState<Set<string>>(new Set())

  useEffect(() => {
    const albumUrn = album.data?.urn
    if (!library || !albumUrn) return
    let cancelled = false

    library
      .isSaved(albumUrn)
      .then((res) => {
        if (!cancelled) setIsSaved(res)
      })
      .catch(() => {})

    if (typeof library.listSaved === 'function') {
      library
        .listSaved('track')
        .then((res) => {
          if (!cancelled && res?.items) {
            const next = new Set(res.items.map((i) => i.urn))
            setSavedTrackUrns((prev) => {
              if (prev.size === next.size && [...prev].every((u) => next.has(u))) return prev
              return next
            })
          }
        })
        .catch(() => {})
    }

    const off = ctx.on('library/changed', (kind) => {
      if (!kind || kind === 'album') {
        library
          .isSaved(albumUrn)
          .then((res) => {
            if (!cancelled) setIsSaved(res)
          })
          .catch(() => {})
      }
      if (kind === 'track' && typeof library.listSaved === 'function') {
        library
          .listSaved('track')
          .then((res) => {
            if (!cancelled && res?.items) {
              const next = new Set(res.items.map((i) => i.urn))
              setSavedTrackUrns((prev) => {
                if (prev.size === next.size && [...prev].every((u) => next.has(u))) return prev
                return next
              })
            }
          })
          .catch(() => {})
      }
    })
    return () => {
      cancelled = true
      off()
    }
  }, [ctx, album.data?.urn])

  const handleTrackAddToFavorites = useCallback(
    async (track: Track) => {
      if (!library) return
      setSavedTrackUrns((prev) => new Set([...prev, track.urn]))
      await library.setSaved(track.urn, true)
      if (sources?.setLoved) {
        await sources.setLoved(track.urn, true).catch(() => {})
      }
    },
    [library, sources],
  )

  const handleToggleSave = useCallback(async () => {
    if (!library || !album.data?.urn) return
    const next = !isSaved
    await library.setSaved(album.data.urn, next)
    setIsSaved(next)
  }, [library, album.data?.urn, isSaved])

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
      } else if (sortKey === 'album' || sortKey === 'plays') {
        const aAlb = a.albumTitle || album.data?.title || ''
        const bAlb = b.albumTitle || album.data?.title || ''
        cmp = aAlb.localeCompare(bAlb, undefined, { numeric: true, sensitivity: 'base' })
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
    return list
  }, [tracks, sortKey, sortOrder, album.data?.title])

  const sortedUrns = useMemo(() => sortedTracks.map((track) => track.urn), [sortedTracks])

  if (album.status === 'loading' || album.status === 'idle') {
    return h(Pending, { label: 'Loading album…' })
  }
  if (album.status === 'error' || !album.data) {
    return h(EmptyState, {
      icon: 'alert',
      title: 'Album unavailable',
      description: album.error?.message,
    })
  }

  const detail = album.data

  const isLocalAlbum = Boolean(
    detail.urn.startsWith('BBeBee:local:') ||
      detail.urn.startsWith('local:') ||
      (detail.tracks.length > 0 &&
        detail.tracks.every((t) => t.urn.startsWith('BBeBee:local:') || t.urn.startsWith('local:'))),
  )

  const collectionSubmenu = addToCollectionSubmenu(library, [detail.urn], collections, {
    title: '加入文件夹',
  })

  const albumMenuItems: MenuItemSpec[] = []

  if (collectionSubmenu) {
    albumMenuItems.push({
      id: 'add-to-folder',
      label: '加入文件夹',
      icon: tablerIcon('folder', { size: 20 }),
      submenu: collectionSubmenu,
    })
  }

  albumMenuItems.push({
    id: 'toggle-library',
    label: isSaved ? '从音乐库中删除' : '添加到音乐库',
    icon: isSaved ? tablerIcon('heart', { size: 20 }) : tablerIcon('heart-filled', { size: 20 }),
    tone: isSaved ? 'danger' : undefined,
    onSelect: () => void handleToggleSave(),
  })

  if (player) {
    albumMenuItems.push({
      id: 'enqueue',
      label: '加入播放列表',
      icon: tablerIcon('plus', { size: 20 }),
      onSelect: () => player.enqueueLast(sortedUrns),
    })
  }

  if (!isLocalAlbum && downloads) {
    albumMenuItems.push({
      id: 'download',
      label: '下载',
      icon: tablerIcon('download', { size: 20 }),
      onSelect: () => void downloads.enqueue(sortedUrns),
    })
  }

  const sleepSubmenu = sleepTimerSubmenu(sleepTimer)
  if (sleepSubmenu) {
    albumMenuItems.push({
      id: 'sleep-timer',
      label: sleepTimer?.state.active ? '睡眠定时器 (已开启)' : '睡眠定时器',
      icon: tablerIcon('clock', { size: 20 }),
      submenu: sleepSubmenu,
    })
  }

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
    return sortOrder === 'asc'
      ? tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4 } })
      : tablerIcon('chevron-down', { size: 16, style: { marginLeft: 4 } })
  }

  const sortLabelMap: Record<AlbumSortKey, string> = {
    trackNo: '默认顺序',
    title: '标题',
    album: '专辑',
    plays: '专辑',
    duration: '时长',
  }

  const sortMenuItems: MenuItemSpec[] = [
    {
      id: 'sort-trackNo',
      label: '默认顺序',
      icon: sortKey === 'trackNo' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('trackNo'),
    },
    {
      id: 'sort-title',
      label: '标题',
      icon: sortKey === 'title' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('title'),
    },
    {
      id: 'sort-album',
      label: '专辑',
      icon: (sortKey === 'album' || sortKey === 'plays') ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('album'),
    },
    {
      id: 'sort-duration',
      label: '时长',
      icon: sortKey === 'duration' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortKey('duration'),
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

  const yearText = detail.year || (detail.releaseDate ? detail.releaseDate.slice(0, 4) : '')
  const totalDurationStr = formatTotalDuration(detail.tracks)

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'linear-gradient(180deg, var(--surface-hover, rgba(95, 135, 255, 0.15)) 0%, var(--surface-1, rgba(8, 13, 26, 0.7)) 280px, var(--bg-primary, #080A10) 100%)',
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
            detail.artists?.[0]?.name?.[0]
              ? detail.artists[0].name[0].toUpperCase()
              : tablerIcon('music', { size: 18 }),
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
              background: detail.tracks.length === 0 ? 'var(--surface-active, rgba(95, 135, 255, 0.3))' : 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
              border: 'none',
              cursor: detail.tracks.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--glow-brand-md, 0 8px 16px rgba(0, 0, 0, 0.3))',
              color: '#ffffff',
              paddingLeft: 2,
            },
          },
          tablerIcon('play', { size: 28, color: '#ffffff' }),
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
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: () => {
              if (sortedUrns.length > 0) {
                const shuffled = [...sortedUrns].sort(() => Math.random() - 0.5)
                void player?.playNow(shuffled)
              }
            },
          },
          tablerIcon('shuffle', { size: 26 }),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'album-heart-trigger',
            'aria-label': isSaved ? '从音乐库中删除' : '添加到音乐库',
            title: isSaved ? '从音乐库中删除' : '添加到音乐库',
            onClick: () => void handleToggleSave(),
            style: {
              background: 'none',
              border: 'none',
              color: isSaved ? 'var(--color-primary, #5F87FF)' : '#b3b3b3',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          isSaved
            ? tablerIcon('heart-filled', { size: 26, color: 'var(--color-primary, #5F87FF)' })
            : tablerIcon('heart', { size: 26 }),
        ),
        !isLocalAlbum && downloads
          ? h(
              'button',
              {
                type: 'button',
                'data-testid': 'album-download-all',
                title: '下载全部',
                style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
                onClick: () => void downloads.enqueue(sortedUrns),
              },
              tablerIcon('download', { size: 24 }),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'album-more-trigger',
            title: '更多选项',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: async (e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              if (library) {
                try {
                  const cols = await library.listCollections()
                  setCollections(cols)
                } catch {
                  setCollections([])
                }
              }
              setAlbumMenuAnchor({ x: rect.left, y: rect.bottom + 6 })
            },
          },
          tablerIcon('dots', { size: 24 }),
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
          tablerIcon('list', { size: 20 }),
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
            flex: 2,
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
          'data-testid': 'album-sort-album',
          onClick: () => handleHeaderClick('album'),
          style: {
            flex: 1.5,
            textAlign: 'left',
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: sortKey === 'album' || sortKey === 'plays' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            padding: 0,
            fontSize: 13,
            fontWeight: 500,
          },
        },
        '专辑',
        renderSortIndicator('album') || renderSortIndicator('plays'),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'album-sort-duration',
          onClick: () => handleHeaderClick('duration'),
          style: {
            width: 130,
            textAlign: 'right',
            paddingRight: 40,
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: sortKey === 'duration' ? '#FFFFFF' : '#b3b3b3',
            cursor: 'pointer',
            padding: 0,
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
            albumTitle: detail.title,
            inLibrary: track.loved === true || savedTrackUrns.has(track.urn),
            onAddToFavorites: handleTrackAddToFavorites,
            onOpenPlaylistMenu: (t, anchor) => saveToPlaylistMenu.open(t, anchor),
            onPress: () => {
              void player?.playFromContext(track.urn, sortedUrns, {
                context: { kind: 'album', urn: detail.urn, label: detail.title },
              })
            },
            onDownload: !isLocalAlbum && downloads ? () => void downloads.enqueue([track.urn]) : undefined,
            onMore: (anchor) => menu.open({ track }, anchor),
          }),
      }),
    ),
    h(ContextMenu, menu.menuProps),
    h(ContextMenu, {
      open: albumMenuAnchor !== null,
      onClose: () => setAlbumMenuAnchor(null),
      x: albumMenuAnchor?.x ?? 0,
      y: albumMenuAnchor?.y ?? 0,
      items: albumMenuItems,
      title: detail.title,
    }),
    h(ContextMenu, {
      open: sortMenuAnchor !== null,
      onClose: () => setSortMenuAnchor(null),
      x: sortMenuAnchor?.x ?? 0,
      y: sortMenuAnchor?.y ?? 0,
      items: sortMenuItems,
      title: '排序方式',
    }),
    h(SaveToPlaylistPopover, saveToPlaylistMenu.menuProps),
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
