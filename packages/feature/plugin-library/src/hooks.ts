/**
 * View hooks for `ctx.library`.
 *
 * Written once here and consumed by both shells (docs/08 §4). Curation reads
 * are asynchronous *and* change from the outside — the same account on another
 * device, a scan landing, a smart playlist's rules suddenly matching — so every
 * hook re-reads on `library/changed` rather than trusting what it loaded once.
 *
 * A smart playlist's membership is derived and can change with no write at
 * all. That is why `usePlaylist` reloads on `library/changed` too: a scanned
 * track with the right year *is* in the playlist now, and the screen should
 * say so.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  Collection,
  LibraryEntry,
  LibraryService,
  Paged,
  Playlist,
  PlaylistDetail,
  SavedKind,
  SourcesService,
} from '@BBeBee/protocol'
import { serviceOf, type AsyncState } from '@BBeBee/ui-core'

export interface LibraryRead<T> extends AsyncState<T> {
  reload(): void
}

/**
 * Run a curation read, reloading whenever the library changes.
 *
 * `key` is how the caller says the read's *inputs* changed — a playlist URN, a
 * saved kind — because `read` is a fresh closure on every render and effect
 * dependencies cannot reference it without re-running forever.
 */
function useLibraryRead<T>(ctx: Context, read: () => Promise<T>, key: string): LibraryRead<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'idle' })
  const [generation, setGeneration] = useState(0)
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ ...prev, status: 'loading' }))
    readRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
      })
    return () => void (cancelled = true)
  }, [ctx, key, generation])

  useEffect(() => {
    const offChanged = ctx.on('library/changed', () => setGeneration((n) => n + 1))
    const offCollections = ctx.on('library/collections-changed', () => setGeneration((n) => n + 1))
    return () => {
      offChanged()
      offCollections()
    }
  }, [ctx])

  return { ...state, reload: useCallback(() => setGeneration((n) => n + 1), []) }
}

/** Walk every page of a paged read. Playlists and shelves are small; a shelf fifty screens long is not. */
async function readAll<T>(read: (cursor?: string) => Promise<Paged<T>>): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const page = await read(cursor)
    items.push(...page.items)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return items
}

export function usePlaylists(ctx: Context): LibraryRead<readonly Playlist[]> {
  return useLibraryRead(
    ctx,
    () => readAll((cursor) => ctx.library.listPlaylists(cursor ? { cursor } : undefined)),
    'playlists',
  )
}

/** One playlist, or `undefined` when there is no such URN. */
export function usePlaylist(ctx: Context, urn: string | undefined): LibraryRead<PlaylistDetail | undefined> {
  return useLibraryRead(
    ctx,
    () => (urn ? ctx.library.getPlaylist(urn) : Promise.resolve(undefined)),
    `playlist:${urn ?? ''}`,
  )
}

export function useSaved(ctx: Context, kind?: SavedKind): LibraryRead<readonly LibraryEntry[]> {
  return useLibraryRead(
    ctx,
    () => readAll((cursor) => ctx.library.listSaved(kind, cursor ? { cursor } : undefined)),
    `saved:${kind ?? 'all'}`,
  )
}

export function useCollections(ctx: Context): LibraryRead<readonly Collection[]> {
  return useLibraryRead(ctx, () => ctx.library.listCollections(), 'collections')
}

/**
 * The one control a track row's heart runs.
 *
 * A track has two records of "the user loves this" — `track_stats.loved`,
 * which draws the heart and drives the catalogue's `onlyLoved` query
 * (docs/07 §4.7), and its `library_items` row, which is what the shelf reads.
 * The heart writes **both**, because a user pressing one heart has expressed
 * one intent and the two stores disagreeing is a bug they would see: a
 * hearted track missing from Favourites, or an unsaved one still in the
 * heart's list.
 *
 * Both reads go through `serviceOf`, so a build with no library (or a test
 * with no sources) degrades to whichever half is loaded rather than throwing.
 */
export function useToggleFavorite(ctx: Context): (urn: string, saved: boolean) => Promise<void> {
  return useCallback(
    async (urn: string, saved: boolean) => {
      // The catalogue's flag first: it is what draws the heart, and a failed
      // shelf write must not leave the heart unlit.
      await serviceOf<SourcesService>(ctx, 'sources')?.setLoved(urn, saved)
      await serviceOf<LibraryService>(ctx, 'library')?.setSaved(urn, saved)
    },
    [ctx],
  )
}

/** The header numbers a playlists screen shows without re-deriving them per row. */
export interface LibrarySummary {
  playlists: number
  smart: number
  collections: number
  saved: number
}

export function summariseLibrary(
  playlists: readonly Playlist[],
  collections: readonly Collection[],
  saved: readonly LibraryEntry[],
): LibrarySummary {
  return {
    playlists: playlists.length,
    smart: playlists.filter((playlist) => playlist.isSmart === true).length,
    collections: collections.length,
    saved: saved.length,
  }
}
