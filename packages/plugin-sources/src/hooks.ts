/**
 * View hooks for `ctx.sources`.
 *
 * Written once here and consumed by both shells (docs/08 4). Catalogue reads
 * are asynchronous and paged, so these are the one place where "loading",
 * "empty" and "failed" are distinguished — a view that conflates them shows a
 * blank pane and tells the user nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { SourceFormatError } from '@BBeBee/protocol'
import type {
  Album,
  AlbumDetail,
  CatalogQuery,
  DebugStep,
  ImportReport,
  Paged,
  SourceRecord,
  Track,
  TraceEvent,
} from '@BBeBee/protocol'
import { parseSourceInput } from './identity.js'
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

/* ── importing, editing and diagnosing (docs/06 §9, §10) ────────────────── */

/** What the import screen shows while and after a paste. */
export interface ImportState {
  text: string
  setText(next: string): void
  /** Non-blocking: what a paste *would* import, shown before committing. */
  preview: { count: number; names: string[] } | undefined
  /** Per-entry problems, from the last attempt. Every one of them, not the first. */
  issues: readonly { path: string; message: string }[]
  busy: boolean
  report: ImportReport | undefined
  submit(): void
  reset(): void
}

/**
 * Pasting a source string.
 *
 * The preview is the point. A user pasting a set from a forum has no way to
 * know what is in it, and an import that silently adds eleven sources is one
 * they cannot undo without knowing which eleven. So the string is parsed as
 * they type — cheap, local, no network — and the names are shown before
 * anything is written.
 */
export function useSourceImport(ctx: Context): ImportState {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ImportReport | undefined>(undefined)
  const [issues, setIssues] = useState<readonly { path: string; message: string }[]>([])

  const preview = useMemo(() => {
    if (!text.trim()) return undefined
    try {
      const entries = parseSourceInput(text)
      return {
        count: entries.length,
        // The name off the parsed value, falling back to the URL: a document
        // with neither is one import will reject anyway, and a preview row
        // reading "undefined" helps nobody decide whether to go ahead.
        names: entries.map((entry) => nameOf(entry.value)),
      }
    } catch {
      // A half-typed paste is not an error yet. Problems are reported on
      // submit, where the user has said they are finished.
      return undefined
    }
  }, [text])

  const submit = useCallback(() => {
    if (!text.trim() || busy) return
    setBusy(true)
    setIssues([])
    void ctx.sources
      .import(text)
      .then((result) => {
        setReport(result)
        /*
         * ⚠️ A rejected entry arrives *in the report*, not as a throw: one
         * malformed document never rejects the rest of a set (docs/06 §9). So
         * a paste whose only document is bad resolves successfully with an
         * empty `added` — and a screen reading only the `catch` would show
         * nothing at all and look like the button did not work.
         */
        setIssues(
          result.rejected.flatMap((entry) =>
            entry.error.issues.length > 0
              ? entry.error.issues
              : [{ path: entry.sourceName ?? `entry ${entry.index}`, message: entry.error.message }],
          ),
        )
        // Cleared only on what actually landed, so a failed paste is still
        // there to fix rather than lost to a screen that emptied itself.
        if (result.added.length > 0 || result.updated.length > 0) setText('')
      })
      .catch((error: unknown) => {
        setIssues(
          error instanceof SourceFormatError && error.issues.length > 0
            ? error.issues
            : [{ path: '', message: error instanceof Error ? error.message : String(error) }],
        )
      })
      .finally(() => setBusy(false))
  }, [ctx, text, busy])

  const reset = useCallback(() => {
    setText('')
    setIssues([])
    setReport(undefined)
  }, [])

  return { text, setText, preview, issues, busy, report, submit, reset }
}

/** One source's document, editable in place. */
export interface EditorState {
  text: string
  setText(next: string): void
  dirty: boolean
  saving: boolean
  error: string | undefined
  save(): void
  revert(): void
}

/**
 * Editing a source's document without re-importing it.
 *
 * docs/06 §10: the debug screen *is* the source editor — change a rule, re-run
 * the step, keep the trace. That loop is what makes a rotted source a
 * seconds-long fix instead of a hunt for wherever the string came from.
 *
 * Saving goes through `import`, which dedupes on `sourceUrl` and therefore
 * keeps the id: every URN, cached row, cookie jar and playlist reference
 * survives the edit.
 */
export function useSourceEditor(ctx: Context, sourceId: string | undefined): EditorState {
  const sources = useSources(ctx)
  const record = sources.find((r) => r.id === sourceId)
  const original = record?.docJson ?? ''

  const [text, setText] = useState(original)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [base, setBase] = useState(original)

  // Reset when the underlying document changes beneath the editor — a
  // re-import, or a different source selected. Comparing against the *base*
  // rather than the text means an edit in progress is not thrown away by an
  // unrelated re-render.
  useEffect(() => {
    if (original !== base) {
      setBase(original)
      setText(original)
    }
  }, [original, base])

  const save = useCallback(() => {
    if (saving || !record) return
    setSaving(true)
    setError(undefined)
    void ctx.sources
      .import(text)
      .then(() => setBase(text))
      .catch((error: unknown) => {
        setError(
          error instanceof SourceFormatError && error.issues.length > 0
            ? error.issues.map((i) => `${i.path}: ${i.message}`).join('\n')
            : error instanceof Error
              ? error.message
              : String(error),
        )
      })
      .finally(() => setSaving(false))
  }, [ctx, record, text, saving])

  const revert = useCallback(() => {
    setText(base)
    setError(undefined)
  }, [base])

  return { text, setText, dirty: text !== base, saving, error, save, revert }
}

/** A running or finished trace. */
export interface TraceState {
  events: readonly TraceEvent[]
  running: boolean
  run(step: DebugStep): void
  clear(): void
}

/**
 * The step tracer, as a screen consumes it.
 *
 * Events are appended as they arrive rather than collected: a request to a
 * server that has stopped answering shows as a line with no status and nothing
 * after it, which *is* the diagnosis. Waiting for the run to finish would show
 * nothing at all until it gave up (docs/06 §10).
 */
export function useSourceTrace(ctx: Context, sourceId: string | undefined): TraceState {
  const [events, setEvents] = useState<readonly TraceEvent[]>([])
  const [running, setRunning] = useState(false)
  // Bumped on every run, so a trace still streaming into a screen the user has
  // moved on from stops appending instead of interleaving with the new one.
  const generation = useRef(0)

  const run = useCallback(
    (step: DebugStep) => {
      if (!sourceId) return
      const mine = ++generation.current
      setEvents([])
      setRunning(true)
      void (async () => {
        try {
          for await (const event of ctx.sources.debug(sourceId, step)) {
            if (generation.current !== mine) return
            setEvents((prev) => [...prev, event])
          }
        } finally {
          if (generation.current === mine) setRunning(false)
        }
      })()
    },
    [ctx, sourceId],
  )

  const clear = useCallback(() => {
    generation.current++
    setEvents([])
    setRunning(false)
  }, [])

  useEffect(() => clear, [clear])

  return { events, running, run, clear }
}


/** A pasted document's display name, before anything has validated it. */
function nameOf(value: unknown): string {
  if (!value || typeof value !== 'object') return 'unnamed source'
  const doc = value as Record<string, unknown>
  if (typeof doc.sourceName === 'string' && doc.sourceName.trim()) return doc.sourceName
  if (typeof doc.sourceUrl === 'string' && doc.sourceUrl.trim()) return doc.sourceUrl
  return 'unnamed source'
}
