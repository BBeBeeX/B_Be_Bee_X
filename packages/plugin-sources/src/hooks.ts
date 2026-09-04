/**
 * View hooks for `ctx.sources`.
 *
 * Written once here and consumed by both shells (docs/08 4). Catalogue reads
 * are asynchronous and paged, so these are the one place where "loading",
 * "empty" and "failed" are distinguished — a view that conflates them shows a
 * blank pane and tells the user nothing.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  Album,
  AlbumDetail,
  CatalogQuery,
  Paged,
  SourceRecord,
  Track,
} from '@BBeBee/protocol'
import { useServiceState, shallowArrayEqual, type AsyncState } from '@BBeBee/ui-core'

/**
 * A paged catalogue read, as a view needs it.
 *
 * Not a data-fetching library: no cache, no revalidation, no retries. It runs
 * the query, tracks the three states a screen must distinguish, and reloads on
 * `library/changed` — which is what makes a scan appear as it progresses
 * rather than after it finishes.
 */
export interface PagedState<T> extends AsyncState<Paged<T>> {
  /** Everything loaded so far, across pages. */
  items: readonly T[]
  hasMore: boolean
  loadMore: () => void
  reload: () => void
}

function usePagedRead<T>(
  ctx: Context,
  read: (query: CatalogQuery) => Promise<Paged<T>>,
  query: CatalogQuery,
  key: string,
): PagedState<T> {
  const [state, setState] = useState<AsyncState<Paged<T>>>({ status: 'idle' })
  const [items, setItems] = useState<readonly T[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [generation, setGeneration] = useState(0)

  const run = useCallback(
    (from: string | undefined, append: boolean) => {
      let cancelled = false
      setState((prev) => ({ ...prev, status: 'loading' }))
      read({ ...query, page: from ? { cursor: from } : undefined })
        .then((page) => {
          if (cancelled) return
          setItems((prev) => (append ? [...prev, ...page.items] : page.items))
          setCursor(page.cursor)
          setState({ status: 'ready', data: page })
        })
        .catch((error: unknown) => {
          if (cancelled) return
          // Surfaced, never swallowed: a catalogue read that fails silently
          // looks identical to an empty library.
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          })
        })
      return () => void (cancelled = true)
    },
    // `query` is an object literal at nearly every call site; `key` is how a
    // caller says its contents changed.
    [read, key],
  )

  useEffect(() => run(undefined, false), [run, generation])

  // A scan writes rows as it goes, so the library fills in rather than
  // appearing all at once when the walk finishes.
  useEffect(() => {
    const off = ctx.on('library/changed', () => setGeneration((n) => n + 1))
    return () => void off()
  }, [ctx])

  return {
    ...state,
    items,
    hasMore: state.data?.hasMore ?? false,
    loadMore: () => {
      if (cursor && state.status !== 'loading') run(cursor, true)
    },
    reload: () => setGeneration((n) => n + 1),
  }
}

export function useTracks(ctx: Context, query: CatalogQuery = {}): PagedState<Track> {
  const read = useCallback((q: CatalogQuery) => ctx.sources.listTracks(q), [ctx])
  return usePagedRead(ctx, read, query, JSON.stringify(query))
}

export function useAlbums(ctx: Context, query: CatalogQuery = {}): PagedState<Album> {
  const read = useCallback((q: CatalogQuery) => ctx.sources.listAlbums(q), [ctx])
  return usePagedRead(ctx, read, query, JSON.stringify(query))
}

/** One album with its tracks. `undefined` data means "no such album". */
export function useAlbum(ctx: Context, urn: string | undefined): AsyncState<AlbumDetail> {
  const [state, setState] = useState<AsyncState<AlbumDetail>>({ status: 'idle' })

  useEffect(() => {
    if (!urn) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    ctx.sources
      .getAlbum(urn)
      .then((album) => {
        if (cancelled) return
        setState(
          album
            ? { status: 'ready', data: album }
            : { status: 'error', error: new Error(`no album ${urn}`) },
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })
    return () => void (cancelled = true)
  }, [ctx, urn])

  return state
}

/** The imported sources, for the source list (docs/08 4). */
export function useSources(ctx: Context): readonly SourceRecord[] {
  return useServiceState(
    ctx,
    ['source/imported', 'source/changed', 'source/removed', 'source/registered', 'source/unregistered'],
    () => ctx.sources.sources,
    { isEqual: shallowArrayEqual },
  )
}

/**
 * Which sources are live right now.
 *
 * Distinct from `useSources`: a row can be imported and enabled but not yet
 * registered, and the difference is what a "starting…" state is made of.
 */
export function useLiveSourceIds(ctx: Context): readonly string[] {
  return useServiceState(
    ctx,
    ['source/registered', 'source/unregistered'],
    () => ctx.sources.providers.map((p) => p.sourceId),
    { isEqual: shallowArrayEqual },
  )
}
