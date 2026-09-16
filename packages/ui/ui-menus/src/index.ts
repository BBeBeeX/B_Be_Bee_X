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
import type {} from '@BBeBee/protocol'
import type {
  ContextMenuProps,
  MenuAnchor,
  MenuItemSpec,
  SubmenuSpec,
} from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import type {
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
): SubmenuSpec | undefined {
  if (!library || trackUrns.length === 0) return undefined
  return {
    title: '添加到歌单',
    searchPlaceholder: '查找歌单',
    emptyLabel: '没有匹配的歌单',
    create: {
      label: '新建歌单',
      placeholder: '歌单名称',
      onSelect: async (name) => {
        const playlist = await library.createPlaylist(name)
        await library.addTracks(playlist.urn, trackUrns)
      },
    },
    items: playlists.map((playlist) => ({
      id: playlist.urn,
      label: playlist.name,
      ...(playlist.isSmart ? { disabled: true } : {}),
      onSelect: async () => {
        await library.addTracks(playlist.urn, trackUrns)
      },
    })),
  }
}

/* ── the collection submenu ─────────────────────────────────────────────── */

/**
 * "Add to a collection" — the folder counterpart of the playlist submenu.
 *
 * A collection holds any URN, so the caller passes what it means to add: a
 * playlist adds itself (its songs are then in the library *through* it), a
 * track adds its own URN. Same structure as the playlist submenu: filter,
 * create, list.
 */
export function addToCollectionSubmenu(
  library: LibraryService | undefined,
  urns: readonly string[],
  collections: readonly Collection[],
): SubmenuSpec | undefined {
  if (!library || urns.length === 0) return undefined
  return {
    title: '加入合集',
    searchPlaceholder: '查找合集',
    emptyLabel: '没有匹配的合集',
    create: {
      label: '新建合集',
      placeholder: '合集名称',
      onSelect: async (name) => {
        const collection = await library.createCollection(name)
        await library.addToCollection(collection.id, urns)
      },
    },
    items: collections.map((collection) => ({
      id: collection.id,
      label: collection.name,
      onSelect: async () => {
        await library.addToCollection(collection.id, urns)
      },
    })),
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

  const collectionSubmenu = addToCollectionSubmenu(library, [track.urn], opts.collections ?? [])
  if (collectionSubmenu) {
    items.push({ id: 'add-to-collection', label: '加入合集', icon: '🗂', submenu: collectionSubmenu })
  }

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
  if (submenu) items.push({ id: 'add-to-collection', label: '加入合集', icon: '🗂', submenu })
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
  const state = useMenuState<{ title: string; urns: readonly string[] }>()
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

/**
 * Every action a playlist row offers.
 *
 * `tracks` are the playlist's track URNs: "add to the queue" and "download"
 * mean the whole list, and "add to another playlist" copies it. A caller that
 * has not loaded them passes none, and those items disappear rather than
 * acting on a partial list.
 */
export function playlistMenuItems(
  ctx: Context,
  playlist: { urn: string; name: string },
  tracks: readonly string[],
  playlists: readonly Playlist[] = [],
  collections: readonly Collection[] = [],
  opts: { pinned?: boolean; onTogglePin?: () => void } = {},
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const items: MenuItemSpec[] = []

  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? '取消置顶歌单' : '置顶歌单',
      icon: '📌',
      onSelect: opts.onTogglePin,
    })
  }

  if (library) {
    items.push({
      id: 'save-to-library',
      label: '添加到音乐库',
      icon: '＋',
      onSelect: () => library.setSaved(playlist.urn, true),
    })
  }

  if (player && tracks.length > 0) {
    items.push({
      id: 'enqueue',
      label: '加入播放列表',
      icon: '＋',
      onSelect: () => player.enqueueLast([...tracks]),
    })
  }

  if (downloads && tracks.length > 0) {
    items.push({
      id: 'download',
      label: '下载',
      icon: '⬇',
      onSelect: () => void downloads.enqueue([...tracks]),
    })
  }

  const submenu = addToPlaylistSubmenu(library, tracks, playlists)
  if (submenu) items.push({ id: 'add-to-playlist', label: '添加到歌单', icon: '≡', submenu })

  // The playlist itself, not its tracks: a collection is a folder, and the
  // songs are in the library *through* the playlist. Editing the playlist
  // later is reflected, because nothing was copied.
  const collectionSubmenu = addToCollectionSubmenu(library, [playlist.urn], collections)
  if (collectionSubmenu) {
    items.push({ id: 'add-to-collection', label: '加入合集', icon: '🗂', submenu: collectionSubmenu })
  }

  return items
}

/**
 * Every action a collection row offers.
 *
 * No "add to library": a collection has an id, not a URN, so there is nothing
 * `library_items` could hold. The rest operate on the collection's track
 * members, which the caller resolves.
 */
export function collectionMenuItems(
  ctx: Context,
  trackUrns: readonly string[],
  playlists: readonly Playlist[] = [],
  opts: { pinned?: boolean; onTogglePin?: () => void } = {},
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const items: MenuItemSpec[] = []

  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? '取消置顶歌单' : '置顶歌单',
      icon: '📌',
      onSelect: opts.onTogglePin,
    })
  }

  if (player && trackUrns.length > 0) {
    items.push({
      id: 'enqueue',
      label: '加入播放列表',
      icon: '＋',
      onSelect: () => player.enqueueLast([...trackUrns]),
    })
  }

  if (downloads && trackUrns.length > 0) {
    items.push({
      id: 'download',
      label: '下载',
      icon: '⬇',
      onSelect: () => void downloads.enqueue([...trackUrns]),
    })
  }

  const submenu = addToPlaylistSubmenu(library, trackUrns, playlists)
  if (submenu) items.push({ id: 'add-to-playlist', label: '添加到歌单', icon: '≡', submenu })

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
function useMenuState<T>() {
  const [open, setOpen] = useState<{
    target: T
    anchor: MenuAnchor
    opts?: { pinned?: boolean; onTogglePin?: () => void }
  } | undefined>(undefined)
  const [playlists, setPlaylists] = useState<readonly Playlist[]>([])
  const [collections, setCollections] = useState<readonly Collection[]>([])

  const show = useCallback(
    (
      target: T,
      anchor?: MenuAnchor,
      ctx?: Context,
      opts?: { pinned?: boolean; onTogglePin?: () => void },
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
    opts?: { pinned?: boolean; onTogglePin?: () => void },
  ): void
}

/** A playlist row's menu. `tracks` are its resolved track URNs, when the caller has them. */
export function usePlaylistMenu(ctx: Context): PlaylistMenuController {
  const state = useMenuState<{ playlist: { urn: string; name: string }; tracks: readonly string[] }>()
  const open = useCallback(
    (
      playlist: { urn: string; name: string },
      tracks: readonly string[],
      anchor?: MenuAnchor,
      opts?: { pinned?: boolean; onTogglePin?: () => void },
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
    opts?: { pinned?: boolean; onTogglePin?: () => void },
  ): void
}

/** A collection row's menu. `trackUrns` are its track members, resolved by the caller. */
export function useCollectionMenu(ctx: Context): CollectionMenuController {
  const state = useMenuState<{ title: string; trackUrns: readonly string[] }>()
  const open = useCallback(
    (
      title: string,
      trackUrns: readonly string[],
      anchor?: MenuAnchor,
      opts?: { pinned?: boolean; onTogglePin?: () => void },
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
        ? collectionMenuItems(ctx, state.open.target.trackUrns, state.playlists, state.open.opts)
        : [],
      ...(state.open ? { title: state.open.target.title } : {}),
    },
  }
}
