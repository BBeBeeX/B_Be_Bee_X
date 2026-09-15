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
  DownloadsService,
  LibraryService,
  PlayerService,
  Playlist,
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

  // Only when it *is* a favourite: an "unlike" on something not liked is a
  // control that does nothing, and the heart in the row already toggles on.
  if (track.loved) {
    items.push({
      id: 'remove-favourite',
      label: '从“最喜欢的歌曲”中删除',
      icon: '♡',
      tone: 'danger',
      onSelect: async () => {
        await sources?.setLoved(track.urn, false)
        await library?.setSaved(track.urn, false)
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
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const items: MenuItemSpec[] = []

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
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const items: MenuItemSpec[] = []

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
  const [open, setOpen] = useState<{ target: T; anchor: MenuAnchor } | undefined>(undefined)
  const [playlists, setPlaylists] = useState<readonly Playlist[]>([])

  const show = useCallback((target: T, anchor?: MenuAnchor, ctx?: Context) => {
    setOpen({ target, anchor: anchorOf(anchor) })
    if (!ctx) return
    void serviceOf<LibraryService>(ctx, 'library')
      ?.listPlaylists()
      .then((page) => setPlaylists(page.items))
      .catch(() => setPlaylists([]))
  }, [])

  const close = useCallback(() => setOpen(undefined), [])
  return { open, playlists, show, close }
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
      items: state.open ? trackMenuItems(ctx, state.open.target, { ...opts, playlists: state.playlists }) : [],
      ...(state.open ? { title: state.open.target.track.title } : {}),
    },
  }
}

export interface PlaylistMenuController extends MenuController {
  open(playlist: { urn: string; name: string }, tracks: readonly string[], anchor?: MenuAnchor): void
}

/** A playlist row's menu. `tracks` are its resolved track URNs, when the caller has them. */
export function usePlaylistMenu(ctx: Context): PlaylistMenuController {
  const state = useMenuState<{ playlist: { urn: string; name: string }; tracks: readonly string[] }>()
  const open = useCallback(
    (playlist: { urn: string; name: string }, tracks: readonly string[], anchor?: MenuAnchor) =>
      state.show({ playlist, tracks }, anchor, ctx),
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
        ? playlistMenuItems(ctx, state.open.target.playlist, state.open.target.tracks, state.playlists)
        : [],
      ...(state.open ? { title: state.open.target.playlist.name } : {}),
    },
  }
}

export interface CollectionMenuController extends MenuController {
  open(title: string, trackUrns: readonly string[], anchor?: MenuAnchor): void
}

/** A collection row's menu. `trackUrns` are its track members, resolved by the caller. */
export function useCollectionMenu(ctx: Context): CollectionMenuController {
  const state = useMenuState<{ title: string; trackUrns: readonly string[] }>()
  const open = useCallback(
    (title: string, trackUrns: readonly string[], anchor?: MenuAnchor) =>
      state.show({ title, trackUrns }, anchor, ctx),
    [state, ctx],
  )
  return {
    open,
    menuProps: {
      open: state.open !== undefined,
      onClose: state.close,
      x: state.open?.anchor.x ?? 0,
      y: state.open?.anchor.y ?? 0,
      items: state.open ? collectionMenuItems(ctx, state.open.target.trackUrns, state.playlists) : [],
      ...(state.open ? { title: state.open.target.title } : {}),
    },
  }
}
