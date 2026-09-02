/**
 * `ctx.sources` — the source registry, the source documents, and the
 * catalogue cache.
 *
 * Three responsibilities, one service, because they are three views of one
 * question — **which music backends exist, and what do they hold?**
 *
 *   the documents  imported strings, stored as rows, exported and diffed
 *   the registry   which of them are live, and lookup by id or URN
 *   the catalogue  what they answered, cached and searchable offline
 *
 * The registry half is deliberately dumb: it stores, resolves, and asks. Every
 * decision about what a source *can* do lives in its derived `capabilities`,
 * and every decision about what to show lives in a shell.
 *
 * Note what is *not* here: interpreting a document. That is
 * `plugin-source-runtime`'s only job, and it reaches this service the same way
 * `plugin-source-local` does — by registering a `MediaProvider`.
 *
 * See docs/06-music-sources.md §1, §4.1, §9 and docs/11-roadmap-M1.md §4.6.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
// Pulls the service and event augmentations (`ctx.sources`, `source/*`) into
// this program. Without it a consumer compiling in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'
import { ProviderError, SourceError, SourceFormatError, tryParseUrn } from '@BBeBee/protocol'
import type {
  AggregatedSearch,
  AggregatedSearchEntry,
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  CatalogCounts,
  CatalogQuery,
  CheckReport,
  DebugStep,
  Disposable,
  ImportOptions,
  ImportReport,
  MediaProvider,
  Paged,
  SearchQuery,
  SearchResult,
  SourceRecord,
  SourcesService,
  Track,
  TraceEvent,
} from '@BBeBee/protocol'
import { Catalog } from './catalog.js'
import {
  changedFields,
  exportableDocument,
  hash32,
  parseSourceInput,
  recordFor,
  validateDocument,
} from './identity.js'
import { SourceStore } from './store.js'

export interface SourcesConfig {
  /**
   * How long `searchAll` waits for a source before reporting it as pending.
   *
   * A slow backend must not hold the whole result set: the search returns what
   * it has and says which sources are still running (docs/06 §4.1).
   */
  searchTimeoutMs?: number
}

const DEFAULT_SEARCH_TIMEOUT_MS = 10_000

/**
 * A provider that can explain itself.
 *
 * Implemented by the source runtime, which is the only thing with rules to
 * trace. Structural rather than declared, so `plugin-source-local` — which has
 * no rules — simply is not one, and `debug` says so instead of inventing a
 * trace for a provider that does not have steps.
 */
interface DebuggableProvider extends MediaProvider {
  debug(step: DebugStep): AsyncIterable<TraceEvent>
}

function isDebuggable(p: MediaProvider): p is DebuggableProvider {
  return typeof (p as Partial<DebuggableProvider>).debug === 'function'
}

/** Whether a source can answer a search at all — method *and* capability. */
function canSearch(provider: MediaProvider): boolean {
  if (typeof provider.search !== 'function') return false
  const { search } = provider.capabilities
  return search.tracks || search.albums || search.artists || search.playlists
}

/**
 * Map anything a provider throws onto the taxonomy.
 *
 * The runtime does this itself for rules (docs/06 §7), but the registry is the
 * boundary where a misbehaving provider would otherwise take down a whole
 * fan-out, so it fails soft and attributes the error to its source.
 */
function asSourceError(error: unknown, sourceId: string): SourceError {
  if (error instanceof SourceError) return error
  return new ProviderError(
    error instanceof Error ? error.message : String(error),
    sourceId,
    undefined,
    { cause: error },
  )
}

export class Sources extends Service implements SourcesService {
  // The catalogue cache and the `sources` table are both SQL (docs/11 MD-3).
  static inject = ['db']

  /** Insertion-ordered, which is the order `searchAll` reports in. */
  private readonly registry = new Map<string, MediaProvider>()
  private catalog!: Catalog
  private store!: SourceStore
  /** Mirrors the `sources` table, so reads are synchronous for the UI. */
  private records: SourceRecord[] = []

  constructor(
    ctx: Context,
    private readonly config: SourcesConfig = {},
  ) {
    super(ctx, 'sources')
  }

  async [Service.init]() {
    this.catalog = new Catalog(this.ctx.db)
    this.store = new SourceStore(this.ctx.db)
    this.records = await this.store.all()

    // Any source's rows get indexed without the writer knowing an index
    // exists — the scanner emits this, and so does the runtime's cache path.
    return this.ctx.on('library/changed', (kind, urns) => {
      if (kind !== 'track') return
      void this.catalog.index(urns).catch((error: unknown) => {
        this.ctx.logger.warn(`sources: could not index ${urns.length} track(s): ${String(error)}`)
      })
    })
  }

  /* ── the registry ──────────────────────────────────────────────────── */

  /**
   * Register a live source.
   *
   * Returns a disposer, so a source whose fiber unloads — or a user who signs
   * out — takes its registration with it and everything downstream simply
   * stops seeing it. No invalidation protocol, no stale rows.
   */
  register(provider: MediaProvider): Disposable {
    const { sourceId } = provider
    if (!sourceId) throw new Error('sources: a provider must have a sourceId')

    if (this.registry.has(sourceId)) {
      // Two providers claiming one source id would make URNs ambiguous — the
      // one thing the URN scheme exists to prevent (docs/07 §1). The `sources`
      // table's UNIQUE(source_url) is the other half of the same guarantee,
      // one layer down.
      this.ctx.logger.warn(
        `sources: source "${sourceId}" is already registered; ignoring the duplicate`,
      )
      return () => {}
    }

    this.registry.set(sourceId, provider)
    this.ctx.emit('source/registered', sourceId)

    return () => {
      // Identity-checked so a late disposer cannot unregister its replacement.
      if (this.registry.get(sourceId) !== provider) return
      this.registry.delete(sourceId)
      this.ctx.emit('source/unregistered', sourceId)
    }
  }

  get providers(): readonly MediaProvider[] {
    return [...this.registry.values()]
  }

  get(sourceId: string): MediaProvider | undefined {
    return this.registry.get(sourceId)
  }

  /**
   * Resolve a URN to the source that owns it.
   *
   * Two Navidrome servers are two sources, and a row from one must never
   * resolve to the other.
   */
  forUrn(urn: string): MediaProvider | undefined {
    const parsed = tryParseUrn(urn)
    return parsed && this.registry.get(parsed.sourceId)
  }

  /**
   * Fan out across every source that supports search.
   *
   * Returns per-source results *and* per-source errors. It never rejects and
   * never merges into one list, because a merged list silently drops a failing
   * backend and the UI then cannot say "Navidrome: 12 results · Jellyfin:
   * unreachable" — which is the honest thing to show (docs/06 §4.1).
   */
  async searchAll(
    query: SearchQuery,
    opts: { sourceIds?: string[]; timeoutMs?: number } = {},
  ): Promise<AggregatedSearch> {
    const timeoutMs = opts.timeoutMs ?? this.config.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
    const wanted = opts.sourceIds && new Set(opts.sourceIds)

    const asked = this.providers.filter((p) => (!wanted || wanted.has(p.sourceId)) && canSearch(p))

    const bySource = await Promise.all(
      asked.map((provider) => this.searchOne(provider, query, timeoutMs)),
    )
    return { bySource }
  }

  private async searchOne(
    provider: MediaProvider,
    query: SearchQuery,
    timeoutMs: number,
  ): Promise<AggregatedSearchEntry> {
    const { sourceId } = provider
    const startedAt = Date.now()

    // `search` is optional; `canSearch` established it is here.
    const inFlight = Promise.resolve(provider.search!(query)).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error: asSourceError(error, sourceId) }),
    )

    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<{ ok: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: 'timeout' }), timeoutMs)
    })

    try {
      const outcome = await Promise.race([inFlight, timedOut])
      const tookMs = Date.now() - startedAt

      // A source that ran long is reported as still running, not cancelled:
      // cancelling would throw away a result the user may still want, and
      // there is no cancellation channel to do it politely.
      if (outcome.ok === 'timeout') return { sourceId, pending: true, tookMs }
      if (outcome.ok) return { sourceId, result: outcome.result, pending: false, tookMs }
      return { sourceId, error: outcome.error, pending: false, tookMs }
    } finally {
      clearTimeout(timer)
    }
  }

  /* ── sources as data ───────────────────────────────────────────────── */

  get sources(): readonly SourceRecord[] {
    return this.records
  }

  source(id: string): SourceRecord | undefined {
    return this.records.find((r) => r.id === id)
  }

  /**
   * Import one document or a set of them.
   *
   * Three properties matter more than the mechanics:
   *
   *  - **Nothing is imported silently.** The report is what the review screen
   *    renders; the caller decides what to keep.
   *  - **A set is partially importable.** One malformed entry in a set of
   *    forty does not reject the other thirty-nine.
   *  - **Update preserves identity.** Matching on `sourceUrl` keeps the id, so
   *    every URN, cached row, jar and playlist reference survives the edit.
   */
  async import(input: string, opts: ImportOptions = {}): Promise<ImportReport> {
    const report: ImportReport = {
      added: [],
      updated: [],
      unchanged: [],
      rejected: [],
      conflicts: [],
    }

    const entries = parseSourceInput(input)
    const now = Date.now()
    const selected = opts.select && new Set(opts.select)

    for (const [index, entry] of entries.entries()) {
      let doc
      try {
        doc = validateDocument(entry, index)
      } catch (error) {
        const issue = error instanceof SourceFormatError ? error : undefined
        report.rejected.push({
          index,
          ...(nameOf(entry) ? { sourceName: nameOf(entry)! } : {}),
          message: issue
            ? `${issue.message}: ${issue.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`
            : String(error),
        })
        continue
      }

      if (selected && !selected.has(doc.sourceUrl)) continue

      const docJson = JSON.stringify(entry)
      const existing = await this.store.byUrl(doc.sourceUrl)

      if (!existing) {
        const record = recordFor(doc, {
          docJson,
          now,
          ...(opts.group ? { group: opts.group } : {}),
          ...(opts.originUri ? { originUri: opts.originUri } : {}),
        })
        await this.store.put(record)
        report.added.push(record)
        continue
      }

      if (existing.docHash === hash32(docJson)) {
        report.unchanged.push(existing)
        continue
      }

      const changed = changedFields(existing.doc, doc)

      // A source the user fixed themselves must not be silently replaced by a
      // re-import of the version that was broken.
      if (existing.locallyModified && !opts.overwrite) {
        report.conflicts.push({ record: existing, changedFields: changed })
        continue
      }

      const record = recordFor(doc, {
        docJson,
        now,
        importedAt: existing.importedAt,
        sortOrder: existing.sortOrder,
        ...(opts.group ?? existing.group ? { group: opts.group ?? existing.group! } : {}),
        ...(opts.originUri ? { originUri: opts.originUri } : {}),
      })
      await this.store.put(record)
      report.updated.push({ record, changedFields: changed })
    }

    await this.refresh()

    const touched = [...report.added, ...report.updated.map((u) => u.record)]
    if (touched.length) this.ctx.emit('source/imported', touched.map((r) => r.id))
    for (const { record, changedFields: fields } of report.updated) {
      this.ctx.emit('source/changed', record.id, fields)
    }

    return report
  }

  /**
   * Serialise sources back to a shareable string.
   *
   * Symmetrical with `import`: app-maintained fields are stripped, and no
   * credential can be present because none was ever stored in the document.
   * Export → import round-trips to an identical set.
   */
  async export(ids?: string[]): Promise<string> {
    const wanted = ids && new Set(ids)
    const docs = this.records
      .filter((r) => !wanted || wanted.has(r.id))
      .map((r) => exportableDocument(r.doc))
    return Promise.resolve(`${JSON.stringify(docs, null, 2)}\n`)
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    await this.store.setEnabled(id, on, Date.now())
    await this.refresh()
    this.ctx.emit('source/changed', id, ['enabled'])
  }

  async remove(id: string, opts: { forgetCatalogue?: boolean } = {}): Promise<void> {
    await this.store.remove(id, opts)
    await this.refresh()
    this.ctx.emit('source/removed', id, opts.forgetCatalogue === true)
  }

  /**
   * Health run over one or many sources.
   *
   * Reach the source, and — where it can — search and resolve a stream, which
   * is the shortest path that exercises every rule a user depends on. The
   * result updates the row, so the source list can sort by health and the
   * stale badge stays honest.
   */
  async check(ids?: string[], opts: { signal?: AbortSignal } = {}): Promise<CheckReport[]> {
    const wanted = ids && new Set(ids)
    const targets = this.providers.filter((p) => !wanted || wanted.has(p.sourceId))
    const reports: CheckReport[] = []

    for (const provider of targets) {
      if (opts.signal?.aborted) break
      reports.push(await this.checkOne(provider))
    }
    return reports
  }

  private async checkOne(provider: MediaProvider): Promise<CheckReport> {
    const sourceId = provider.sourceId
    const startedAt = Date.now()
    let failedStep: CheckReport['failedStep'] = 'ping'

    try {
      const reachable = await provider.ping()
      const respondTimeMs = Date.now() - startedAt
      if (!reachable) {
        return await this.recordCheck({
          sourceId,
          ok: false,
          respondTimeMs,
          failedStep: 'ping',
          message: 'unreachable',
          checkedAt: Date.now(),
        })
      }

      if (canSearch(provider)) {
        failedStep = 'search'
        await provider.search!({ text: 'a' })
      }

      return await this.recordCheck({
        sourceId,
        ok: true,
        respondTimeMs,
        checkedAt: Date.now(),
      })
    } catch (error) {
      return await this.recordCheck({
        sourceId,
        ok: false,
        respondTimeMs: Date.now() - startedAt,
        failedStep,
        message: asSourceError(error, sourceId).message,
        checkedAt: Date.now(),
      })
    }
  }

  private async recordCheck(report: CheckReport): Promise<CheckReport> {
    await this.store.recordCheck(report.sourceId, {
      ok: report.ok,
      ...(report.respondTimeMs !== undefined ? { respondTimeMs: report.respondTimeMs } : {}),
      ...(report.message ? { message: report.message } : {}),
      at: report.checkedAt,
    })
    await this.refresh()
    this.ctx.emit('source/checked', report.sourceId, report)
    return report
  }

  /**
   * Stream a trace of one step.
   *
   * Delegated to the source itself, because only the thing that owns the rules
   * can say what each one received and produced. A source with no rules — the
   * local files provider — says so rather than inventing a trace.
   */
  debug(id: string, step: DebugStep): AsyncIterable<TraceEvent> {
    const provider = this.registry.get(id)
    if (!provider) return once({ at: Date.now(), kind: 'error', message: `no source "${id}"` })
    if (!isDebuggable(provider)) {
      return once({
        at: Date.now(),
        kind: 'error',
        message: `source "${id}" has no rules to trace`,
      })
    }
    return provider.debug(step)
  }

  /** Re-read the table after a write. Cheap: the source list is tens of rows. */
  private async refresh(): Promise<void> {
    this.records = await this.store.all()
  }

  /* ── the catalogue cache ───────────────────────────────────────────── */

  listTracks(query?: CatalogQuery): Promise<Paged<Track>> {
    return this.catalog.listTracks(query)
  }

  listAlbums(query?: CatalogQuery): Promise<Paged<Album>> {
    return this.catalog.listAlbums(query)
  }

  listArtists(query?: CatalogQuery): Promise<Paged<Artist>> {
    return this.catalog.listArtists(query)
  }

  getAlbum(urn: string): Promise<AlbumDetail | undefined> {
    return this.catalog.getAlbum(urn)
  }

  getArtist(urn: string): Promise<ArtistDetail | undefined> {
    return this.catalog.getArtist(urn)
  }

  searchLocal(text: string, opts?: { limit?: number; sourceIds?: string[] }): Promise<SearchResult> {
    return this.catalog.searchLocal(text, opts)
  }

  counts(): Promise<CatalogCounts> {
    return this.catalog.counts()
  }

  /** Re-index tracks directly. `library/changed` is the usual route. */
  reindex(urns: string[]): Promise<void> {
    return this.catalog.index(urns)
  }
}

function nameOf(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== 'object') return undefined
  const name = (entry as Record<string, unknown>).sourceName
  return typeof name === 'string' ? name : undefined
}

async function* once(event: TraceEvent): AsyncIterable<TraceEvent> {
  yield event
}

export { Catalog } from './catalog.js'
export { SourceStore } from './store.js'
export {
  allowedHostsFor,
  changedFields,
  exportableDocument,
  parseSourceInput,
  sourceIdFor,
  validateDocument,
} from './identity.js'

export const name = 'plugin-sources'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.sources` is usable.
 */
export async function apply(ctx: Context, config: SourcesConfig = {}) {
  const fiber = await ctx.plugin(Sources, config)
  return () => void fiber.dispose()
}

export default { name, apply }
