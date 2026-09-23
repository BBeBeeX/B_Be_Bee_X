/**
 * The context-menu models: which actions exist for a track, a playlist and a
 * collection, and what each one does.
 *
 * This is the "write the `if` once" half of docs/08 §1. The kits render
 * `MenuItemSpec`s and know nothing about playlists or queues; this package
 * knows every action and no pixels, so both shells offer the same menu in the
 * same order with the same words.
 *
 * It is Layer 5, not Layer 4, deliberately: it composes four features
 * (`ctx.library`, `ctx.player`, `ctx.downloads`, `ctx.ui`) and names another
 * feature's route id, which a Layer 4 plugin may not do to a sibling. Every
 * service is read through `serviceOf`, so a build without downloads simply
 * has no Download item rather than a menu that throws.
 *
 * The plugin/collection submenu is where the user's spec lives: a filter
 * field, a "new playlist" row, then every playlist.
 */

import { useCallback, useState } from 'react'
import type { Context } from 'cordis'
import { parseUrn } from '@BBeBee/protocol'
import type {} from '@BBeBee/protocol'
import type {
  ContextMenuProps,
  MenuAnchor,
  MenuItemSpec,
  SubmenuSpec,
} from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import type {
  ArtworkRef,
  Collection,
  DownloadsService,
  LibraryService,
  PlayerService,
  Playlist,
  SleepTimerService,
  SourcesService,
  Track,
  UiService,
} from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'

/* ── the submenu every entity menu shares ───────────────────────────────── */

/**
 * "Add to a playlist": filter, create, then the list.
 *
 * The model is precomputed rather than fetched inside the submenu because the
 * kit is dumb by design — it renders what it is handed. The caller resolves
 * `playlists` once, when the menu opens.
 *
 * Smart playlists are disabled: their tracks come from rules, so there is no
 * row an add could write (the service refuses, and a menu item that throws is
 * worse than one that is visibly unavailable).
 */
export function addToPlaylistSubmenu(
  library: LibraryService | undefined,
  trackUrns: readonly string[],
  playlists: readonly Playlist[],
  opts?: { title?: string; searchPlaceholder?: string; excludePlaylistUrn?: string },
): SubmenuSpec | undefined {
  if (!library || trackUrns.length === 0) return undefined
  const filteredPlaylists = opts?.excludePlaylistUrn
    ? playlists.filter((p) => p.urn !== opts.excludePlaylistUrn)
    : playlists
  return {
    title: opts?.title ?? '添加到歌单',
    searchPlaceholder: opts?.searchPlaceholder ?? '查找歌单',
    emptyLabel: '没有匹配的歌单',
    create: {
      label: '新建歌单',
      placeholder: '歌单名称',
      onSelect: async (name) => {
        const playlist = await library.createPlaylist(name)
        await library.addTracks(playlist.urn, trackUrns)
      },
    },
    items: filteredPlaylists.map((playlist) => ({
      id: playlist.urn,
      label: playlist.name,
      icon: 'playlist-add',
      ...(playlist.isSmart ? { disabled: true } : {}),
      onSelect: async () => {
        await library.addTracks(playlist.urn, trackUrns)
      },
    })),
  }
}

/* ── the collection submenu ─────────────────────────────────────────────── */

/**
 * "Move/add to a collection" — the folder counterpart of the playlist submenu.
 */
export function addToCollectionSubmenu(
  library: LibraryService | undefined,
  urns: readonly string[],
  collections: readonly Collection[],
  opts?: {
    title?: string
    searchPlaceholder?: string
    createLabel?: string
    currentFolderId?: string
    onSelectFolder?: (folderId: string | null) => void | Promise<void>
    onMoved?: () => void
  },
): SubmenuSpec | undefined {
  const allowedUrns = urns.filter((urn) => {
    try {
      return parseUrn(urn).kind !== 'track'
    } catch {
      return true
    }
  })
  if (!library || (allowedUrns.length === 0 && !opts?.onSelectFolder)) return undefined
  const items: MenuItemSpec[] = []

  if (opts?.currentFolderId) {
    items.push({
      id: '__move_root',
      label: '移至根目录',
      icon: 'folder',
      onSelect: async () => {
        if (opts.onSelectFolder) {
          await opts.onSelectFolder(null)
        } else {
          await library.removeFromCollection(opts.currentFolderId!, allowedUrns).catch(() => {})
          opts.onMoved?.()
        }
      },
    })
  }

  for (const collection of collections) {
    items.push({
      id: collection.id,
      label: collection.name,
      icon: 'folder',
      onSelect: async () => {
        if (opts?.onSelectFolder) {
          await opts.onSelectFolder(collection.id)
        } else {
          if (opts?.currentFolderId && opts.currentFolderId !== collection.id) {
            await library.removeFromCollection(opts.currentFolderId, allowedUrns).catch(() => {})
          }
          await library.addToCollection(collection.id, allowedUrns)
          opts?.onMoved?.()
        }
      },
    })
  }

  return {
    title: opts?.title ?? '加入合集',
    searchPlaceholder: opts?.searchPlaceholder ?? '查找合集',
    emptyLabel: '没有匹配的合集',
    create: {
      label: opts?.createLabel ?? '新建合集',
      placeholder: '合集名称',
      onSelect: async (name) => {
        const collection = await library.createCollection(name)
        if (opts?.onSelectFolder) {
          await opts.onSelectFolder(collection.id)
        } else {
          if (opts?.currentFolderId && opts.currentFolderId !== collection.id) {
            await library.removeFromCollection(opts.currentFolderId, allowedUrns).catch(() => {})
          }
          await library.addToCollection(collection.id, allowedUrns)
          opts?.onMoved?.()
        }
      },
    },
    items,
  }
}

/* ── the sleep timer submenu ────────────────────────────────────────────── */

/**
 * "Sleep Timer" submenu: 5min, 10min, 15min, 30min, 45min, 1h, end of track,
 * and a custom minutes input via `create`.
 */
export function sleepTimerSubmenu(
  sleepTimer: SleepTimerService | undefined,
): SubmenuSpec | undefined {
  if (!sleepTimer) return undefined
  const items: MenuItemSpec[] = []

  if (sleepTimer.state.active) {
    items.push({
      id: 'timer-cancel',
      label: '关闭睡眠定时器',
      icon: '✕',
      tone: 'danger',
      onSelect: () => sleepTimer.cancel(),
    })
  }

  items.push(
    {
      id: 'timer-5m',
      label: '5 分钟',
      onSelect: () => sleepTimer.startDuration(5 * 60 * 1000),
    },
    {
      id: 'timer-10m',
      label: '10 分钟',
      onSelect: () => sleepTimer.startDuration(10 * 60 * 1000),
    },
    {
      id: 'timer-15m',
      label: '15 分钟',
      onSelect: () => sleepTimer.startDuration(15 * 60 * 1000),
    },
    {
      id: 'timer-30m',
      label: '30 分钟',
      onSelect: () => sleepTimer.startDuration(30 * 60 * 1000),
    },
    {
      id: 'timer-45m',
      label: '45 分钟',
      onSelect: () => sleepTimer.startDuration(45 * 60 * 1000),
    },
    {
      id: 'timer-1h',
      label: '1 小时',
      onSelect: () => sleepTimer.startDuration(60 * 60 * 1000),
    },
    {
      id: 'timer-end-of-track',
      label: '曲目结束时',
      onSelect: () => sleepTimer.startEndOfTrack(),
    },
  )

  return {
    title: '睡眠定时器',
    create: {
      label: '自定义时间',
      placeholder: '自定义时间 (单位: 分钟)',
      alwaysVisible: true,
      placement: 'bottom',
      buttonLabel: '确定',
      onSelect: (val: string) => {
        const trimmed = val.trim()
        const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]!, 10)
          const minutes = parseInt(timeMatch[2]!, 10)
          const target = new Date()
          target.setHours(hours, minutes, 0, 0)
          if (target.getTime() <= Date.now()) {
            target.setDate(target.getDate() + 1)
          }
          sleepTimer.startAtEpoch(target.getTime())
          return
        }

        const mins = parseFloat(trimmed)
        if (Number.isFinite(mins) && mins > 0) {
          sleepTimer.startDuration(mins * 60 * 1000)
        }
      },
    },
    items,
  }
}

/* ── tracks ─────────────────────────────────────────────────────────────── */

export interface TrackMenuTarget {
  track: Track
  /**
   * The row's id inside the playlist it is shown in, when it is shown in one.
   * Its presence is what makes "remove from this playlist" offerable.
   */
  playlistItemId?: string
}

export interface TrackMenuOptions {
  /** Set by a playlist detail screen; absent everywhere else. */
  fromPlaylistUrn?: string
  /** Resolved by the hook when the menu opens. */
  playlists?: readonly Playlist[]
  /** Same, for the "add to collection" submenu. */
  collections?: readonly Collection[]
}

/**
 * Every action a track row offers, in the order the menu shows them.
 *
 * Exported and pure of React so the model is testable without a renderer —
 * the same reason `plugin-library`'s smart compiler is a separate file.
 */
export function trackMenuItems(
  ctx: Context,
  target: TrackMenuTarget,
  opts: TrackMenuOptions = {},
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const ui = serviceOf<UiService>(ctx, 'ui')
  const track = target.track
  const items: MenuItemSpec[] = []

  const submenu = addToPlaylistSubmenu(library, [track.urn], opts.playlists ?? [])
  if (submenu) items.push({ id: 'add-to-playlist', label: '加入歌单', icon: '＋', submenu })

  if (library && opts.fromPlaylistUrn && target.playlistItemId) {
    const playlistUrn = opts.fromPlaylistUrn
    const itemId = target.playlistItemId
    items.push({
      id: 'remove-from-playlist',
      label: '从此歌单中删除',
      icon: '－',
      tone: 'danger',
      onSelect: () => library.removeItems(playlistUrn, [itemId]),
    })
  }

  if (track.loved) {
    items.push({
      id: 'remove-favourite',
      label: '从“最喜欢的音乐”中删除',
      icon: '♡',
      tone: 'danger',
      onSelect: async () => {
        await sources?.setLoved(track.urn, false)
        await library?.setSaved(track.urn, false)
      },
    })
  } else if (sources || library) {
    items.push({
      id: 'add-favourite',
      label: '添加至“最喜欢的音乐”',
      icon: '♥',
      onSelect: async () => {
        await sources?.setLoved(track.urn, true)
        await library?.setSaved(track.urn, true)
      },
    })
  }

  if (player) {
    items.push({
      id: 'enqueue',
      label: '加入播放列表',
      icon: '＋',
      onSelect: () => player.enqueueLast([track.urn]),
    })
  }

  if (downloads) {
    items.push({
      id: 'download',
      label: '下载',
      icon: '⬇',
      onSelect: () => void downloads.enqueue([track.urn]),
    })
  }

  const sleepTimer = serviceOf<SleepTimerService>(ctx, 'sleepTimer')
  const sleepSubmenu = sleepTimerSubmenu(sleepTimer)
  if (sleepSubmenu) {
    items.push({
      id: 'sleep-timer',
      label: sleepTimer?.state.active ? '睡眠定时器 (已开启)' : '睡眠定时器',
      icon: '⏱',
      submenu: sleepSubmenu,
    })
  }

  if (ui && track.albumUrn) {
    const albumUrn = track.albumUrn
    items.push({
      id: 'go-to-album',
      label: '转至专辑',
      icon: '▸',
      onSelect: () => ui.navigate(ALBUM_VIEWS.album, { urn: albumUrn }),
    })
  }

  return items
}

/**
 * The one-item menu for an entity that is only a candidate for a folder:
 * an album (or anything else) whose useful action here is "put this in a
 * collection".
 */
export function addToCollectionOnlyItems(
  ctx: Context,
  urns: readonly string[],
  collections: readonly Collection[],
  opts: { pinned?: boolean; onTogglePin?: () => void } = {},
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const submenu = addToCollectionSubmenu(library, urns, collections)
  const items: MenuItemSpec[] = []
  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? '取消置顶歌单' : '置顶歌单',
      icon: '📌',
      onSelect: opts.onTogglePin,
    })
  }
  if (submenu) items.push({ id: 'add-to-collection', label: '移动至文件夹', icon: 'folder', submenu })
  return items
}

export interface AddToCollectionController extends MenuController {
  open(
    title: string,
    urns: readonly string[],
    anchor?: MenuAnchor,
    opts?: { pinned?: boolean; onTogglePin?: () => void },
  ): void
}

/** A folder menu for an arbitrary entity — currently the album rows' menu. */
export function useAddToCollection(ctx: Context): AddToCollectionController {
  const state = useMenuState<
    { title: string; urns: readonly string[] },
    { pinned?: boolean; onTogglePin?: () => void }
  >()
  const open = useCallback(
    (
      title: string,
      urns: readonly string[],
      anchor?: MenuAnchor,
      opts?: { pinned?: boolean; onTogglePin?: () => void },
    ) => state.show({ title, urns }, anchor, ctx, opts),
    [state, ctx],
  )
  return {
    open,
    menuProps: {
      open: state.open !== undefined,
      onClose: state.close,
      x: state.open?.anchor.x ?? 0,
      y: state.open?.anchor.y ?? 0,
      items: state.open
        ? addToCollectionOnlyItems(ctx, state.open.target.urns, state.collections, state.open.opts)
        : [],
      ...(state.open ? { title: state.open.target.title } : {}),
    },
  }
}

/* ── playlists and collections ──────────────────────────────────────────── */

export interface PlaylistMenuOptions {
  pinned?: boolean
  isSaved?: boolean
  currentFolderId?: string
  onTogglePin?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onMoved?: () => void
}

/**
 * Every action a playlist row offers.
 */
export function playlistMenuItems(
  ctx: Context,
  playlist: { urn: string; name: string },
  tracks: readonly string[],
  playlists: readonly Playlist[] = [],
  collections: readonly Collection[] = [],
  opts: PlaylistMenuOptions = {},
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const items: MenuItemSpec[] = []

  // 1. 编辑详情 (if provided)
  if (opts.onEdit) {
    items.push({
      id: 'edit-details',
      label: '编辑详情',
      icon: 'pencil',
      onSelect: opts.onEdit,
    })
  }

  // 2. 删除 (if provided)
  if (opts.onDelete) {
    items.push({
      id: 'delete-playlist',
      label: '删除',
      icon: 'delete',
      tone: 'danger',
      divider: true,
      onSelect: opts.onDelete,
    })
  }

  // 3. 置顶歌单
  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? '取消置顶歌单' : '置顶歌单',
      icon: 'pin',
      onSelect: opts.onTogglePin,
    })
  }

  // 4. 添加到音乐库
  if (library && opts.isSaved !== true) {
    items.push({
      id: 'save-to-library',
      label: '添加到音乐库',
      icon: 'plus',
      onSelect: () => library.setSaved(playlist.urn, true),
    })
  }

  // 5. 播放 / 加入播放列表
  if (player && tracks.length > 0) {
    items.push({
      id: 'enqueue',
      label: '播放',
      icon: 'play',
      onSelect: () => player.enqueueLast([...tracks]),
    })
  }

  // 6. 下载
  if (downloads && tracks.length > 0) {
    items.push({
      id: 'download',
      label: '下载',
      icon: 'download',
      onSelect: () => void downloads.enqueue([...tracks]),
    })
  }

  // 7. 添加至其他歌单
  const submenu = addToPlaylistSubmenu(library, tracks, playlists, {
    title: '添加至其他歌单',
    excludePlaylistUrn: playlist.urn,
  })
  if (submenu) {
    items.push({
      id: 'add-to-playlist',
      label: '添加至其他歌单',
      icon: 'playlist-add',
      submenu,
    })
  }

  // 8. 移动至文件夹
  const collectionSubmenu = addToCollectionSubmenu(library, [playlist.urn], collections, {
    title: '移动至文件夹',
    searchPlaceholder: '查找文件夹',
    createLabel: '新建文件夹',
    currentFolderId: opts.currentFolderId,
    onMoved: opts.onMoved,
  })
  if (collectionSubmenu) {
    items.push({
      id: 'add-to-collection',
      label: '移动至文件夹',
      icon: 'folder',
      submenu: collectionSubmenu,
    })
  }

  return items
}

export interface CollectionMenuOptions {
  collectionId?: string
  parentId?: string | null
  pinned?: boolean
  onTogglePin?: () => void
  onRename?: () => void
  onDelete?: () => void
  onCreatePlaylist?: () => void
  onCreateFolder?: () => void
  onMoveToFolder?: (targetFolderId: string | null) => void
  onPlay?: () => void
}

/**
 * Every action a collection row offers.
 */
export function collectionMenuItems(
  ctx: Context,
  trackUrns: readonly string[],
  playlists?: readonly Playlist[],
  collections?: readonly Collection[],
  opts?: CollectionMenuOptions,
): MenuItemSpec[]
export function collectionMenuItems(
  ctx: Context,
  trackUrns: readonly string[],
  playlists?: readonly Playlist[],
  opts?: CollectionMenuOptions,
): MenuItemSpec[]
export function collectionMenuItems(
  ctx: Context,
  trackUrns: readonly string[],
  playlists: readonly Playlist[] = [],
  collectionsOrOpts?: readonly Collection[] | CollectionMenuOptions,
  maybeOpts?: CollectionMenuOptions,
): MenuItemSpec[] {
  const isCollectionsArray = Array.isArray(collectionsOrOpts)
  const collections: readonly Collection[] = isCollectionsArray ? (collectionsOrOpts as readonly Collection[]) : []
  const opts: CollectionMenuOptions = isCollectionsArray
    ? (maybeOpts ?? {})
    : ((collectionsOrOpts as CollectionMenuOptions | undefined) ?? {})

  const library = serviceOf<LibraryService>(ctx, 'library')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const items: MenuItemSpec[] = []

  // 1. 重命名 (if provided)
  if (opts.onRename) {
    items.push({
      id: 'rename-collection',
      label: '重命名',
      icon: 'pencil',
      onSelect: opts.onRename,
    })
  }

  // 2. 删除 (if provided)
  if (opts.onDelete) {
    items.push({
      id: 'delete-collection',
      label: '删除',
      icon: 'delete',
      tone: 'danger',
      divider: true,
      onSelect: opts.onDelete,
    })
  }

  // 3. 置顶文件夹
  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? '取消置顶文件夹' : '置顶文件夹',
      icon: 'pin',
      onSelect: opts.onTogglePin,
    })
  }

  // 4. 创建歌单
  if (opts.onCreatePlaylist) {
    items.push({
      id: 'create-playlist',
      label: '创建歌单',
      icon: 'create-playlist',
      onSelect: opts.onCreatePlaylist,
    })
  }

  // 5. 创建歌单文件夹
  if (opts.onCreateFolder) {
    items.push({
      id: 'create-folder',
      label: '创建歌单文件夹',
      icon: 'create-folder',
      onSelect: opts.onCreateFolder,
    })
  }

  // 6. 移动至文件夹
  if (opts.onMoveToFolder || (library && opts.collectionId)) {
    const availableFolders = collections.filter((c) => c.id !== opts.collectionId)
    const folderSubmenu = addToCollectionSubmenu(
      library,
      opts.collectionId ? [opts.collectionId] : [],
      availableFolders,
      {
        title: '移动至文件夹',
        searchPlaceholder: '查找文件夹',
        createLabel: '新建文件夹',
        currentFolderId: opts.parentId ?? undefined,
        onSelectFolder: async (targetFolderId) => {
          if (opts.onMoveToFolder) {
            opts.onMoveToFolder(targetFolderId)
          } else if (library && opts.collectionId) {
            await library.moveCollection?.(opts.collectionId, targetFolderId)
          }
        },
      },
    )
    if (folderSubmenu) {
      items.push({
        id: 'move-to-folder',
        label: '移动至文件夹',
        icon: 'folder',
        submenu: folderSubmenu,
      })
    }
  }

  // 7. 播放
  if (opts.onPlay || (player && trackUrns.length > 0)) {
    items.push({
      id: 'enqueue',
      label: '播放',
      icon: 'play',
      onSelect: opts.onPlay ?? (() => player?.enqueueLast([...trackUrns])),
    })
  }

  // 8. 下载
  if (downloads && trackUrns.length > 0) {
    items.push({
      id: 'download',
      label: '下载',
      icon: 'download',
      onSelect: () => void downloads.enqueue([...trackUrns]),
    })
  }

  // 9. 添加至其他歌单
  const submenu = addToPlaylistSubmenu(library, trackUrns, playlists, {
    title: '添加至其他歌单',
  })
  if (submenu) {
    items.push({
      id: 'add-to-playlist',
      label: '添加至其他歌单',
      icon: 'playlist-add',
      submenu,
    })
  }

  return items
}

/* ── controllers ────────────────────────────────────────────────────────── */

export interface MenuController {
  /** Spread straight into the kit's `ContextMenu`. */
  menuProps: ContextMenuProps
}

/** A menu opened with no pointer — a `⋯` button — lands near the middle. */
function fallbackAnchor(): MenuAnchor {
  const width = typeof window === 'undefined' ? 1024 : window.innerWidth
  const height = typeof window === 'undefined' ? 768 : window.innerHeight
  return { x: Math.round(width / 2 - 120), y: Math.round(height / 3) }
}

function anchorOf(anchor: MenuAnchor | undefined): MenuAnchor {
  return anchor ?? fallbackAnchor()
}

/**
 * The open state and the playlist list every entity menu needs.
 *
 * The list is fetched when the menu opens, not when it renders, so a slow
 * `listPlaylists` never delays the menu itself — the submenu fills in when it
 * arrives, and an absent library leaves it empty rather than throwing.
 */
function useMenuState<T, O = unknown>() {
  const [open, setOpen] = useState<{
    target: T
    anchor: MenuAnchor
    opts?: O
  } | undefined>(undefined)
  const [playlists, setPlaylists] = useState<readonly Playlist[]>([])
  const [collections, setCollections] = useState<readonly Collection[]>([])

  const show = useCallback(
    (
      target: T,
      anchor?: MenuAnchor,
      ctx?: Context,
      opts?: O,
    ) => {
      setOpen({ target, anchor: anchorOf(anchor), opts })
      if (!ctx) return
      const library = serviceOf<LibraryService>(ctx, 'library')
      if (!library) return
      void library
        .listPlaylists()
        .then((page) => setPlaylists(page.items))
        .catch(() => setPlaylists([]))
      void library
        .listCollections()
        .then((items) => setCollections(items))
        .catch(() => setCollections([]))
    },
    [],
  )

  const close = useCallback(() => setOpen(undefined), [])
  return { open, playlists, collections, show, close }
}

export interface TrackMenuController extends MenuController {
  open(target: TrackMenuTarget, anchor?: MenuAnchor): void
}

/** A track row's menu. `opts.fromPlaylistUrn` makes "remove from this playlist" appear. */
export function useTrackMenu(ctx: Context, opts: TrackMenuOptions = {}): TrackMenuController {
  const state = useMenuState<TrackMenuTarget>()
  const open = useCallback(
    (target: TrackMenuTarget, anchor?: MenuAnchor) => state.show(target, anchor, ctx),
    [state, ctx],
  )
  return {
    open,
    menuProps: {
      open: state.open !== undefined,
      onClose: state.close,
      x: state.open?.anchor.x ?? 0,
      y: state.open?.anchor.y ?? 0,
      items: state.open
        ? trackMenuItems(ctx, state.open.target, {
            ...opts,
            playlists: state.playlists,
            collections: state.collections,
          })
        : [],
      ...(state.open ? { title: state.open.target.track.title } : {}),
    },
  }
}

export interface PlaylistMenuController extends MenuController {
  open(
    playlist: { urn: string; name: string },
    tracks: readonly string[],
    anchor?: MenuAnchor,
    opts?: PlaylistMenuOptions,
  ): void
}

/** A playlist row's menu. `tracks` are its resolved track URNs, when the caller has them. */
export function usePlaylistMenu(ctx: Context): PlaylistMenuController {
  const state = useMenuState<{ playlist: { urn: string; name: string }; tracks: readonly string[] }, PlaylistMenuOptions>()
  const open = useCallback(
    (
      playlist: { urn: string; name: string },
      tracks: readonly string[],
      anchor?: MenuAnchor,
      opts?: PlaylistMenuOptions,
    ) => state.show({ playlist, tracks }, anchor, ctx, opts),
    [state, ctx],
  )
  return {
    open,
    menuProps: {
      open: state.open !== undefined,
      onClose: state.close,
      x: state.open?.anchor.x ?? 0,
      y: state.open?.anchor.y ?? 0,
      items: state.open
        ? playlistMenuItems(
            ctx,
            state.open.target.playlist,
            state.open.target.tracks,
            state.playlists,
            state.collections,
            state.open.opts,
          )
        : [],
      ...(state.open ? { title: state.open.target.playlist.name } : {}),
    },
  }
}

export interface CollectionMenuController extends MenuController {
  open(
    title: string,
    trackUrns: readonly string[],
    anchor?: MenuAnchor,
    opts?: CollectionMenuOptions,
  ): void
}

/** A collection row's menu. `trackUrns` are its track members, resolved by the caller. */
export function useCollectionMenu(ctx: Context): CollectionMenuController {
  const state = useMenuState<{ title: string; trackUrns: readonly string[] }, CollectionMenuOptions>()
  const open = useCallback(
    (
      title: string,
      trackUrns: readonly string[],
      anchor?: MenuAnchor,
      opts?: CollectionMenuOptions,
    ) => state.show({ title, trackUrns }, anchor, ctx, opts),
    [state, ctx],
  )
  return {
    open,
    menuProps: {
      open: state.open !== undefined,
      onClose: state.close,
      x: state.open?.anchor.x ?? 0,
      y: state.open?.anchor.y ?? 0,
      items: state.open
        ? collectionMenuItems(ctx, state.open.target.trackUrns, state.playlists, state.collections, state.open.opts)
        : [],
      ...(state.open ? { title: state.open.target.title } : {}),
    },
  }
}

export interface SaveToPlaylistTrack {
  urn: string
  title: string
  loved?: boolean
  artists?: readonly { name: string }[]
  artwork?: ArtworkRef | string
}

export interface SaveToPlaylistOption {
  urn: string
  name: string
  trackCount?: number
  pinned?: boolean
  artwork?: ArtworkRef
  isSmart?: boolean
  containsTrack?: boolean
}

export interface SaveToCollectionOption {
  id: string
  name: string
  playlistCount?: number
  playlists: readonly SaveToPlaylistOption[]
}

export interface SaveToPlaylistMenuController {
  open(track: SaveToPlaylistTrack, anchor?: MenuAnchor): void
  close(): void
  menuProps: {
    open: boolean
    onClose: () => void
    x: number
    y: number
    title: string
    liked: boolean
    likedCount: number
    onToggleLiked: () => Promise<void>
    playlists: readonly SaveToPlaylistOption[]
    collections: readonly SaveToCollectionOption[]
    onCreatePlaylist: (name: string, folderId?: string) => Promise<void>
    onTogglePlaylist: (playlistUrn: string, currentlyContains: boolean) => Promise<void>
  }
}

/**
 * Controller for the dedicated "Save to playlist" popover menu triggered by clicking the heart icon.
 */
export function useSaveToPlaylistMenu(ctx: Context): SaveToPlaylistMenuController {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const [active, setActive] = useState<{ track: SaveToPlaylistTrack; anchor: MenuAnchor } | undefined>(undefined)
  const [liked, setLiked] = useState(false)
  const [likedCount, setLikedCount] = useState(0)
  const [playlists, setPlaylists] = useState<readonly SaveToPlaylistOption[]>([])
  const [collections, setCollections] = useState<readonly SaveToCollectionOption[]>([])

  const open = useCallback(
    (track: SaveToPlaylistTrack, anchor?: MenuAnchor) => {
      setActive({ track, anchor: anchorOf(anchor) })
      setLiked(track.loved ?? false)

      if (!library) return

      if (typeof library.isSaved === 'function') {
        void library
          .isSaved(track.urn)
          .then((saved) => setLiked(saved || track.loved === true))
          .catch(() => {})
      }

      if (typeof library.listSaved === 'function') {
        void library
          .listSaved('track')
          .then((res) => setLikedCount(res?.total ?? res?.items?.length ?? 0))
          .catch(() => {})
      }

      void (async () => {
        try {
          const [playlistsRes, collectionsRes] = await Promise.all([
            typeof library.listPlaylists === 'function'
              ? library.listPlaylists().catch(() => ({ items: [] as Playlist[] }))
              : Promise.resolve({ items: [] as Playlist[] }),
            typeof library.listCollections === 'function'
              ? library.listCollections().catch(() => [] as Collection[])
              : Promise.resolve([] as Collection[]),
          ])

          const rawPlaylists = playlistsRes?.items ?? []
          const rawCollections = collectionsRes ?? []

          const initialOptions: SaveToPlaylistOption[] = rawPlaylists.map((p) => ({
            urn: p.urn,
            name: p.name,
            trackCount: p.trackCount,
            pinned: (p as { pinned?: boolean }).pinned,
            artwork: p.artwork,
            isSmart: p.isSmart,
            containsTrack: false,
          }))
          setPlaylists(initialOptions)

          if (rawCollections.length > 0) {
            setCollections(
              rawCollections.map((c) => ({
                id: c.id,
                name: c.name,
                playlistCount: 0,
                playlists: [],
              })),
            )
          }

          // If getPlaylist exists, check containment
          let updatedOptions = initialOptions
          if (typeof library.getPlaylist === 'function') {
            const containment = await Promise.all(
              rawPlaylists.map(async (p) => {
                try {
                  const detail = await library.getPlaylist!(p.urn)
                  const contains = detail?.items?.some((i) => i.trackUrn === track.urn) ?? false
                  return { urn: p.urn, contains }
                } catch {
                  return { urn: p.urn, contains: false }
                }
              }),
            )
            const map = new Map(containment.map((c) => [c.urn, c.contains]))
            updatedOptions = initialOptions.map((p) => ({
              ...p,
              containsTrack: map.get(p.urn) ?? p.containsTrack,
            }))
            setPlaylists(updatedOptions)
          }

          // If collections exist and listCollectionItems exists
          if (rawCollections.length > 0 && typeof library.listCollectionItems === 'function') {
            const itemsList = await Promise.all(
              rawCollections.map(async (c) => {
                try {
                  const res = await library.listCollectionItems!(c.id)
                  return { id: c.id, urns: new Set(res.items.map((i) => i.urn)) }
                } catch {
                  return { id: c.id, urns: new Set<string>() }
                }
              }),
            )
            const colMap = new Map(itemsList.map((i) => [i.id, i.urns]))
            const allColUrns = new Set(itemsList.flatMap((i) => [...i.urns]))

            setPlaylists(updatedOptions.filter((p) => !allColUrns.has(p.urn)))
            setCollections(
              rawCollections.map((c) => {
                const urns = colMap.get(c.id)
                const contained = updatedOptions.filter((p) => urns?.has(p.urn))
                return {
                  id: c.id,
                  name: c.name,
                  playlistCount: contained.length,
                  playlists: contained,
                }
              }),
            )
          }
        } catch {
          // ignore
        }
      })()
    },
    [library],
  )

  const onToggleLiked = useCallback(async () => {
    if (!active || !library) return
    const next = !liked
    setLiked(next)
    setLikedCount((prev) => (next ? prev + 1 : Math.max(0, prev - 1)))
    await library.setSaved(active.track.urn, next).catch(() => {})
  }, [active, library, liked])

  const onTogglePlaylist = useCallback(
    async (playlistUrn: string, currentlyContains: boolean) => {
      if (!active || !library) return
      const next = !currentlyContains

      setPlaylists((prev) =>
        prev.map((p) =>
          p.urn === playlistUrn
            ? { ...p, containsTrack: next, trackCount: (p.trackCount ?? 0) + (next ? 1 : -1) }
            : p,
        ),
      )
      setCollections((prev) =>
        prev.map((c) => ({
          ...c,
          playlists: c.playlists.map((p) =>
            p.urn === playlistUrn
              ? { ...p, containsTrack: next, trackCount: (p.trackCount ?? 0) + (next ? 1 : -1) }
              : p,
          ),
        })),
      )

      try {
        if (currentlyContains) {
          if (typeof library.getPlaylist === 'function') {
            const detail = await library.getPlaylist(playlistUrn)
            const itemIds = detail?.items?.filter((i) => i.trackUrn === active.track.urn).map((i) => i.id) ?? []
            if (itemIds.length && typeof library.removeItems === 'function') {
              await library.removeItems(playlistUrn, itemIds)
            }
          }
        } else {
          if (typeof library.addTracks === 'function') {
            await library.addTracks(playlistUrn, [active.track.urn])
          }
        }
      } catch {
        // ignore error
      }
    },
    [active, library],
  )

  const onCreatePlaylist = useCallback(
    async (name: string, folderId?: string) => {
      if (!active || !library || !name.trim()) return
      const trimmed = name.trim()
      try {
        const playlist = await library.createPlaylist(trimmed)
        if (folderId && typeof library.addToCollection === 'function') {
          await library.addToCollection(folderId, [playlist.urn]).catch(() => {})
        }
        if (typeof library.addTracks === 'function') {
          await library.addTracks(playlist.urn, [active.track.urn]).catch(() => {})
        }

        const newOption: SaveToPlaylistOption = {
          urn: playlist.urn,
          name: playlist.name,
          trackCount: 1,
          containsTrack: true,
          pinned: false,
          isSmart: false,
        }

        if (folderId) {
          setCollections((prev) =>
            prev.map((c) =>
              c.id === folderId
                ? {
                    ...c,
                    playlistCount: (c.playlistCount ?? 0) + 1,
                    playlists: [...c.playlists, newOption],
                  }
                : c,
            ),
          )
        } else {
          setPlaylists((prev) => [...prev, newOption])
        }
      } catch {
        // ignore error
      }
    },
    [active, library],
  )

  const close = useCallback(() => setActive(undefined), [])

  return {
    open,
    close,
    menuProps: {
      open: active !== undefined,
      onClose: close,
      x: active?.anchor.x ?? 0,
      y: active?.anchor.y ?? 0,
      title: '添加到歌单',
      liked,
      likedCount,
      onToggleLiked,
      playlists,
      collections,
      onCreatePlaylist,
      onTogglePlaylist,
    },
  }
}

