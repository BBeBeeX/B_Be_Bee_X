import { useCallback, useState } from 'react'
import type { Context } from 'cordis'
import type { ContextMenuProps, MenuAnchor } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import type { Collection, LibraryService, Playlist } from '@BBeBee/protocol'

export interface MenuController {
  /** Spread straight into the kit's `ContextMenu`. */
  menuProps: ContextMenuProps
}

/** A menu opened with no pointer — a `⋯` button — lands near the middle. */
export function fallbackAnchor(): MenuAnchor {
  const width = typeof window === 'undefined' ? 1024 : window.innerWidth
  const height = typeof window === 'undefined' ? 768 : window.innerHeight
  return { x: Math.round(width / 2 - 120), y: Math.round(height / 3) }
}

export function anchorOf(anchor: MenuAnchor | undefined): MenuAnchor {
  return anchor ?? fallbackAnchor()
}

/**
 * The open state and the playlist list every entity menu needs.
 *
 * The list is fetched when the menu opens, not when it renders, so a slow
 * `listPlaylists` never delays the menu itself — the submenu fills in when it
 * arrives, and an absent library leaves it empty rather than throwing.
 */
export function useMenuState<T, O = unknown>() {
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
