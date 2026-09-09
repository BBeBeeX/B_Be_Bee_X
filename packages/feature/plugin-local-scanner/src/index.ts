/**
 * `ctx.scanner` — the local filesystem walk.
 *
 * Separate from `plugin-source-local` because scanning is a different concern
 * from serving: this fills the catalogue from files on disk, that answers
 * questions about what is in it (docs/06 §8).
 *
 * Three properties are the whole design, and each is a test:
 *
 *  - **Incremental.** `(size, mtime)` against `scan_entries` decides whether a
 *    file is opened at all, so a rescan of an unchanged library costs stat
 *    calls and nothing else. That is an M1 exit criterion.
 *  - **Interruptible.** Batches inside one transaction, an `AbortSignal` from
 *    the fiber, a checkpoint per batch. A suspend mid-scan costs one batch.
 *  - **Honest.** A file that will not decode is recorded with its reason, not
 *    silently skipped, so "could not import" is a list the user can see.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  AudioMetadata,
  Disposable,
  FileStat,
  ScanProgress,
  ScanRoot,
  ScanSummary,
  ScannerService,
  Uri,
} from '@BBeBee/protocol'
import { forgetFile, importTrack } from './import.js'
import { stableId } from './ids.js'
import { SCANNER_VIEWS } from './views.js'

export interface ScannerConfig {
  /** Files per transaction. A checkpoint costs one batch on interruption. */
  batchSize?: number
  /** Extensions considered audio, lower-case and without the dot. */
  extensions?: string[]
  /** The source these tracks belong to. */
  sourceId?: string
  /** How often to poll where `ctx.fs.watch` is unavailable, in minutes. */
  pollIntervalMinutes?: number
  /** Debounce for filesystem events, so a copy of 200 files is one rescan. */
  watchDebounceMs?: number
}

const DEFAULT_EXTENSIONS = [
  'mp3',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'aiff',
  'aif',
  'wma',
  'alac',
]

/** One file, read but not yet written. */
interface PreparedFile {
  file: FileStat
  metadata?: AudioMetadata
  artwork?: Uint8Array
  error?: string
  unchanged?: boolean
}

interface EntryRow {
  uri: string
  size: number
  mtime: number
  status: string
  track_urn: string | null
}

/**
 * How deep a scan will go.
 *
 * No real music library is 24 directories deep; a symlink loop is unbounded.
 */
const MAX_SCAN_DEPTH = 24

/**
 * How many directories one scan will list, whatever their depth.
 *
 * The depth cap alone is not enough: two directories that link to each other
 * produce 2^depth distinct paths, so a 24-deep walk still costs ~16 million
 * listings and mints a ghost track row per path. This is the budget that makes
 * the blow-up finite in *both* dimensions.
 *
 * 20,000 directories is far beyond any real music library and far below the
 * point where a cycle hurts.
 */
const MAX_SCAN_DIRS = 20_000

export class Scanner extends Service implements ScannerService {
  static inject = ['fs', 'db', 'codec']

  private readonly config: Required<ScannerConfig>

  private readonly ownCtx: Context
  private rootList: ScanRoot[] = []
  private current?: ScanProgress
  private abort?: AbortController
  private watchers: Disposable[] = []
  private watchTimer?: ReturnType<typeof setTimeout>
  private pollTimer?: ReturnType<typeof setTimeout>
  /** Resolves the in-flight scan, so concurrent callers queue rather than race. */
  private inFlight?: Promise<ScanSummary>
  private disposed = false

  constructor(ctx: Context, config: ScannerConfig = {}) {
    super(ctx, 'scanner')
    this.ownCtx = ctx
    this.config = {
      batchSize: config.batchSize ?? 200,
      extensions: (config.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()),
      sourceId: config.sourceId ?? 'local',
      pollIntervalMinutes: config.pollIntervalMinutes ?? 15,
      watchDebounceMs: config.watchDebounceMs ?? 2000,
    }
  }

  async [Service.init]() {
    // A descriptor, not a component: the settings page is listed even on a
    // target whose view package was not loaded, which is what lets a shell
    // show "not available on this platform" rather than a hole (docs/08 §3).
    this.ownCtx.inject(['ui'], (scoped) =>
      scoped.ui.contribute({
        kind: 'settings',
        id: SCANNER_VIEWS.settings,
        section: 'sources',
        title: 'Music folders',
      }),
    )

    await this.ensureSourceRow()
    this.rootList = await this.loadRoots()
    await this.startWatching()

    return () => {
      this.disposed = true
      this.cancel()
      if (this.watchTimer) clearTimeout(this.watchTimer)
      if (this.pollTimer) clearTimeout(this.pollTimer)
      for (const off of this.watchers) off()
      this.watchers = []
    }
  }

  get roots(): readonly ScanRoot[] {
    return this.rootList
  }

  get progress(): ScanProgress | undefined {
    return this.current
  }

  /* ── roots ─────────────────────────────────────────────────────────── */

  async addRoot(uri: Uri, opts: { recursive?: boolean } = {}): Promise<ScanRoot> {
    const existing = this.rootList.find((r) => r.uri === uri)
    if (existing) {
      if (!existing.enabled) {
        await this.setEnabled(existing.id, true)
        return this.rootList.find((r) => r.id === existing.id) ?? { ...existing, enabled: true }
      }
      return existing
    }

    const root: ScanRoot = {
      id: stableId('root', uri),
      uri,
      recursive: opts.recursive ?? true,
      enabled: true,
    }
    await this.ownCtx.db.exec(
      `INSERT INTO scan_roots (id, uri, recursive, enabled) VALUES (?, ?, ?, 1)
       ON CONFLICT(uri) DO UPDATE SET enabled = 1`,
      [root.id, root.uri, root.recursive ? 1 : 0],
    )
    this.rootList = await this.loadRoots()
    await this.startWatching()
    this.ownCtx.emit('scan/roots-changed', this.rootList)
    return root
  }

  async removeRoot(id: string, opts: { forgetTracks?: boolean } = {}): Promise<void> {
    if (opts.forgetTracks) {
      const entries = await this.ownCtx.db.query<{ uri: string }>(
        'SELECT uri FROM scan_entries WHERE root_id = ?',
        [id],
      )
      const removed: string[] = []
      await this.ownCtx.db.transaction(async (tx) => {
        for (const entry of entries) {
          const { removedTrackUrn } = await forgetFile(
            { tx, sourceId: this.config.sourceId, now: Date.now() },
            entry.uri,
          )
          if (removedTrackUrn) removed.push(removedTrackUrn)
        }
      })
      if (removed.length > 0) this.ownCtx.emit('library/changed', 'track', removed)
    }
    // `scan_entries` cascades from the root row.
    await this.ownCtx.db.exec('DELETE FROM scan_roots WHERE id = ?', [id])
    this.rootList = await this.loadRoots()
    await this.startWatching()
    this.ownCtx.emit('scan/roots-changed', this.rootList)
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    await this.ownCtx.db.exec('UPDATE scan_roots SET enabled = ? WHERE id = ?', [on ? 1 : 0, id])
    this.rootList = await this.loadRoots()
    await this.startWatching()
    this.ownCtx.emit('scan/roots-changed', this.rootList)
  }

  /* ── the walk ──────────────────────────────────────────────────────── */

  cancel(): void {
    this.abort?.abort()
  }

  /**
   * Walk the roots.
   *
   * Serialised: a watch event, a poll and a manual scan can all arrive at
   * once, and two concurrent walks would fight over `this.abort` — the second
   * overwriting it, orphaning the first, which then keeps writing rows nobody
   * can cancel. Callers that arrive during a scan get the one already running.
   */
  async scan(opts: { rootId?: string; full?: boolean; signal?: AbortSignal } = {}): Promise<ScanSummary> {
    if (this.inFlight) return this.inFlight
    const run = this.runScan(opts)
    this.inFlight = run
    try {
      return await run
    } finally {
      this.inFlight = undefined
    }
  }

  private async runScan(
    opts: { rootId?: string; full?: boolean; signal?: AbortSignal } = {},
  ): Promise<ScanSummary> {
    const summary: ScanSummary = { added: 0, updated: 0, removed: 0, errors: 0 }
    const roots = this.rootList.filter(
      (r) => r.enabled && (opts.rootId === undefined || r.id === opts.rootId),
    )

    const abort = new AbortController()
    this.abort = abort
    const signal = opts.signal
    const onExternalAbort = () => abort.abort()
    signal?.addEventListener('abort', onExternalAbort)

    try {
      for (const root of roots) {
        if (abort.signal.aborted) break
        await this.scanRoot(root, summary, { full: opts.full ?? false, signal: abort.signal })
      }
      if (!abort.signal.aborted) {
        await this.syncLibraryItems()
      }
    } finally {
      signal?.removeEventListener('abort', onExternalAbort)
      this.abort = undefined
      this.current = undefined
    }

    if (abort.signal.aborted) summary.cancelled = true
    return summary
  }

  private async scanRoot(
    root: ScanRoot,
    summary: ScanSummary,
    opts: { full: boolean; signal: AbortSignal },
  ): Promise<void> {
    this.ownCtx.emit('scan/started', root.id)
    this.current = { rootId: root.id, done: 0 }

    let files: FileStat[]
    let truncated: boolean
    try {
      const walked = await this.walk(root.uri, root.recursive, opts.signal)
      files = walked.files
      truncated = walked.truncated
    } catch (error) {
      await this.ownCtx.db.exec('UPDATE scan_roots SET last_error = ? WHERE id = ?', [
        String(error),
        root.id,
      ])
      summary.errors++
      summary.incomplete = true
      // A root that could not be walked at all is maximally incomplete, and
      // nothing was reconciled — say so rather than reporting a clean scan
      // that happened to change nothing.
      this.ownCtx.emit('scan/finished', root.id, {
        added: summary.added,
        updated: summary.updated,
        removed: summary.removed,
        errors: summary.errors,
        incomplete: true,
      })
      return
    }

    this.current = { rootId: root.id, done: 0, total: files.length }

    const known = new Map<string, EntryRow>()
    for (const row of await this.ownCtx.db.query<EntryRow>(
      'SELECT uri, size, mtime, status, track_urn FROM scan_entries WHERE root_id = ?',
      [root.id],
    )) {
      known.set(row.uri, row)
    }

    const seen = new Set<string>()
    for (let i = 0; i < files.length; i += this.config.batchSize) {
      if (opts.signal.aborted) break
      const batch = files.slice(i, i + this.config.batchSize)
      const changed = await this.importBatch(root, batch, known, seen, summary, opts.full)

      this.current = { rootId: root.id, done: Math.min(i + batch.length, files.length), total: files.length }
      this.ownCtx.emit('scan/progress', root.id, this.current.done, files.length)
      // Emitted per batch, so the library fills progressively rather than
      // after the whole walk — and so the FTS index keeps up.
      if (changed.length > 0) this.ownCtx.emit('library/changed', 'track', changed)
    }

    /*
     * ⚠️ Reconciliation only runs on a *complete* view of the root.
     *
     * "Not in `seen`" means "gone from disk" only if the walk actually
     * reached everywhere. A walk stopped by the depth cap or the directory
     * budget looks identical — and deleting on that basis removes the rows of
     * files that are still sitting on disk, silently, with `removed` counting
     * up as though it were correct. That is worse than the hang the budget
     * replaced: a hang is visible.
     *
     * So a truncated or cancelled walk imports what it saw and removes
     * nothing. The library goes stale rather than wrong, and the warning
     * above says why.
     */
    const complete = !opts.signal.aborted && !truncated
    // Sticky across roots: one root that could not be fully walked makes the
    // whole scan's reconciliation partial, and a caller must not read the
    // aggregate as authoritative.
    if (!complete) summary.incomplete = true
    if (complete) {
      const gone = [...known.keys()].filter((uri) => !seen.has(uri))
      if (gone.length > 0) await this.forgetGone(gone, summary)
    }

    await this.ownCtx.db.exec(
      'UPDATE scan_roots SET last_scan_at = ?, last_error = NULL WHERE id = ?',
      [Date.now(), root.id],
    )
    this.rootList = await this.loadRoots()
    this.ownCtx.emit('scan/finished', root.id, {
      added: summary.added,
      updated: summary.updated,
      // Reported rather than inferred: a caller cannot tell a complete scan
      // that removed nothing from an incomplete one that was not allowed to.
      removed: summary.removed,
      errors: summary.errors,
      ...(complete ? {} : { incomplete: true }),
      ...(opts.signal.aborted ? { cancelled: true } : {}),
    })
  }

  /** One transaction per batch: a checkpoint, not an all-or-nothing scan. */
  private async importBatch(
    root: ScanRoot,
    batch: FileStat[],
    known: Map<string, EntryRow>,
    seen: Set<string>,
    summary: ScanSummary,
    full: boolean,
  ): Promise<string[]> {
    const changed: string[] = []
    const now = Date.now()

    // Reading tags is I/O and must not hold the write lock, so it happens
    // before the transaction opens rather than inside it.
    const prepared: PreparedFile[] = []

    for (const file of batch) {
      seen.add(file.uri)
      const previous = known.get(file.uri)
      // The incremental key. An unchanged file costs one `stat` — which the
      // walk already did — and nothing else.
      if (!full && previous && previous.size === file.size && previous.mtime === file.mtime) {
        prepared.push({ file, unchanged: true })
        continue
      }
      try {
        const metadata = await this.ownCtx.codec.readMetadata(file.uri)
        const artwork = metadata.hasArtwork
          ? await this.ownCtx.codec.readArtwork(file.uri).catch(() => undefined)
          : undefined
        prepared.push({ file, metadata, ...(artwork ? { artwork } : {}) })
      } catch (error) {
        prepared.push({ file, error: error instanceof Error ? error.message : String(error) })
      }
    }

    await this.ownCtx.db.transaction(async (tx) => {
      for (const item of prepared) {
        if (item.unchanged) continue

        if (item.error || !item.metadata) {
          summary.errors++
          await this.writeEntry(tx, root.id, item.file, 'error', null, item.error ?? 'unreadable')
          continue
        }

        const { trackUrn } = await importTrack(
          { tx, sourceId: this.config.sourceId, now },
          {
            uri: item.file.uri,
            size: item.file.size,
            mtime: item.file.mtime,
            metadata: item.metadata,
            ...(item.artwork ? { artwork: item.artwork } : {}),
            format: extensionOf(item.file.uri),
          },
        )
        if (known.has(item.file.uri)) summary.updated++
        else summary.added++
        changed.push(trackUrn)
        await this.writeEntry(tx, root.id, item.file, 'ok', trackUrn, null)
      }
    })

    return changed
  }

  private async writeEntry(
    tx: { exec(sql: string, params?: (string | number | null)[]): Promise<unknown> },
    rootId: string,
    file: FileStat,
    status: string,
    trackUrn: string | null,
    error: string | null,
  ): Promise<void> {
    await tx.exec(
      `INSERT INTO scan_entries (uri, root_id, size, mtime, track_urn, status, error, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uri) DO UPDATE SET
         root_id    = excluded.root_id,
         size       = excluded.size,
         mtime      = excluded.mtime,
         track_urn  = excluded.track_urn,
         status     = excluded.status,
         error      = excluded.error,
         scanned_at = excluded.scanned_at`,
      [file.uri, rootId, file.size, file.mtime, trackUrn, status, error, Date.now()],
    )
  }

  /** Files that are gone take their binding, and any orphaned track, with them. */
  private async forgetGone(uris: string[], summary: ScanSummary): Promise<void> {
    const removed: string[] = []
    await this.ownCtx.db.transaction(async (tx) => {
      for (const uri of uris) {
        const { removedTrackUrn } = await forgetFile(
          { tx, sourceId: this.config.sourceId, now: Date.now() },
          uri,
        )
        if (removedTrackUrn) removed.push(removedTrackUrn)
        await tx.exec('DELETE FROM scan_entries WHERE uri = ?', [uri])
        summary.removed++
      }
    })
    if (removed.length > 0) this.ownCtx.emit('library/changed', 'track', removed)
  }

  /** Ensure all scanned tracks and albums in the catalogue are recorded in library_items. */
  private async syncLibraryItems(): Promise<void> {
    await this.ownCtx.db.exec(
      `INSERT OR IGNORE INTO library_items (urn, kind, source_id, added_at, pinned, sort_key)
       SELECT t.urn, 'track', t.source_id, t.fetched_at, 0, t.sort_title
       FROM tracks t
       WHERE t.source_id = ?`,
      [this.config.sourceId],
    )
    await this.ownCtx.db.exec(
      `INSERT OR IGNORE INTO library_items (urn, kind, source_id, added_at, pinned, sort_key)
       SELECT al.urn, 'album', al.source_id, al.fetched_at, 0, al.sort_title
       FROM albums al
       WHERE al.source_id = ?
         AND EXISTS (SELECT 1 FROM tracks t WHERE t.album_urn = al.urn)`,
      [this.config.sourceId],
    )
  }

  /**
   * Breadth-first walk of a scan root.
   *
   * ⚠️ **Bounded on purpose.** `ctx.fs.list` follows directory symlinks, so a
   * library containing `ln -s . loop` — or two directories linking to each
   * other, which real collections do have — produced a queue that never
   * emptied. The scan did not fail; it ran until the process died, which is
   * the worst shape a bug can take.
   *
   * `visited` catches a path repeating exactly. The depth cap and the total
   * directory budget together catch the general case, where every hop through
   * the link yields a *new* path (`sub/loop/sub/loop/…`) that no URI-keyed set
   * can recognise — and where two mutually-linked directories multiply paths
   * exponentially rather than merely deepening them.
   *
   * Residual, stated rather than hidden: files under a symlinked duplicate
   * directory are still imported once per reachable path, as separate tracks.
   * Collapsing those needs canonical-path identity — `realpath`, or a device
   * and inode — which `ctx.fs` does not expose and Expo's filesystem cannot
   * generally provide. The cap keeps the damage finite and visible.
   */
  private async walk(
    uri: Uri,
    recursive: boolean,
    signal: AbortSignal,
  ): Promise<{ files: FileStat[]; truncated: boolean }> {
    const found = new Map<Uri, FileStat>()
    const visited = new Set<Uri>([uri])
    let queue: Uri[] = [uri]
    let depth = 0

    let listed = 0
    let unreadable = 0
    while (queue.length > 0 && depth <= MAX_SCAN_DEPTH && listed < MAX_SCAN_DIRS) {
      const next: Uri[] = []
      for (const dir of queue) {
        if (signal.aborted) return { files: [...found.values()], truncated: true }
        if (++listed > MAX_SCAN_DIRS) break
        let listing: FileStat[]
        try {
          listing = await this.ownCtx.fs.list(dir)
        } catch {
          /*
           * An unreadable directory is not a scan *failure* — a permissions
           * quirk somewhere in a music folder must not abort the walk. But it
           * *is* a hole in the view, and reconciliation cannot tell a file it
           * could not see from one that is gone: without this, `chmod 000` on
           * a subdirectory deleted its tracks on the next scan, silently.
           */
          unreadable++
          continue
        }
        for (const entry of listing) {
          if (entry.isDirectory) {
            if (!recursive || visited.has(entry.uri)) continue
            visited.add(entry.uri)
            next.push(entry.uri)
            continue
          }
          if (this.isAudio(entry.uri)) found.set(entry.uri, entry)
        }
      }
      queue = next
      depth++
    }

    const truncated = queue.length > 0 || listed >= MAX_SCAN_DIRS || unreadable > 0
    if (unreadable > 0) {
      const ctx = this.ownCtx
      ctx.logger.warn(
        `scanner: ${unreadable} director${unreadable === 1 ? 'y' : 'ies'} under ${uri} could ` +
          'not be read. This scan will not remove anything, because it did not see everything.',
      )
    }
    if (queue.length > 0 || listed >= MAX_SCAN_DIRS) {
      // Say so rather than silently truncating: a library legitimately this
      // large is a bug report worth getting, and a symlink loop is a problem
      // the user can fix once they know it is there.
      const limit =
        listed >= MAX_SCAN_DIRS ? `${MAX_SCAN_DIRS} directories` : `depth ${MAX_SCAN_DEPTH}`
      const ctx = this.ownCtx
      ctx.logger.warn(
        `scanner: stopped at ${limit} under ${uri} — a directory symlink loop, ` +
          'or a tree larger than any real library. This scan will not remove ' +
          'anything, because it did not see everything.',
      )
    }
    return { files: [...found.values()], truncated }
  }

  private isAudio(uri: Uri): boolean {
    const ext = extensionOf(uri)
    return ext !== undefined && this.config.extensions.includes(ext)
  }

  /* ── keeping up with the filesystem ────────────────────────────────── */

  private async startWatching(): Promise<void> {
    for (const off of this.watchers) off()
    this.watchers = []
    if (this.disposed) return

    const enabled = this.rootList.filter((r) => r.enabled)
    if (enabled.length === 0) return

    if (this.ownCtx.fs.canWatch) {
      for (const root of enabled) {
        try {
          const off = await this.ownCtx.fs.watch(root.uri, () => this.scheduleRescan(root.id))
          this.watchers.push(off)
        } catch {
          // A root that cannot be watched still gets scanned on demand.
        }
      }
      return
    }

    // ⚠️ React Native has no `fs.watch`, and neither does the desktop bridge,
    // so the library goes stale between polls and the UI says so rather than
    // implying live updates (docs/04 §1).
    //
    // `ctx.background` is preferred where it exists, because on mobile only
    // the OS scheduler can run work while the app is away. But it is an
    // *optional* service: when it is absent — which is every desktop build
    // until `core-background-electron` lands — the scanner falls back to its
    // own timer. Without that fallback there was no automatic rescan on
    // desktop at all: files changed and the library silently stayed stale.
    let scheduled = false
    this.ownCtx.inject(['background'], (scoped) => {
      scheduled = true
      let cancelled = false
      void scoped.background
        .schedule('scanner:poll', this.config.pollIntervalMinutes, async () => {
          if (!cancelled) await this.scan()
        })
        .then((off) => this.watchers.push(off))
      return () => {
        cancelled = true
        scheduled = false
      }
    })

    if (!scheduled) this.startSelfPoll()
  }

  /**
   * The fallback timer.
   *
   * Deliberately a chained `setTimeout` rather than an interval: a scan that
   * takes longer than the period must not have another queued behind it.
   */
  private startSelfPoll(): void {
    // Floored in milliseconds rather than minutes: a misconfigured 0 must not
    // become a busy loop, but a test may legitimately ask for a fast poll.
    const period = Math.max(50, this.config.pollIntervalMinutes * 60_000)
    const tick = () => {
      this.pollTimer = setTimeout(() => {
        void this.scan()
          .catch(() => undefined)
          .finally(() => {
            if (!this.disposed) tick()
          })
      }, period)
    }
    tick()
    this.watchers.push(() => {
      if (this.pollTimer) clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    })
  }

  private scheduleRescan(rootId: string): void {
    // Debounced: copying 200 files in should be one rescan, not 200.
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.watchTimer = setTimeout(() => {
      void this.scan({ rootId }).catch(() => undefined)
    }, this.config.watchDebounceMs)
  }

  /* ── bookkeeping ───────────────────────────────────────────────────── */

  private async loadRoots(): Promise<ScanRoot[]> {
    const rows = await this.ownCtx.db.query<{
      id: string
      uri: string
      recursive: number
      enabled: number
      last_scan_at: number | null
      last_error: string | null
    }>('SELECT id, uri, recursive, enabled, last_scan_at, last_error FROM scan_roots')

    return rows.map((row) => ({
      id: row.id,
      uri: row.uri,
      recursive: row.recursive === 1,
      enabled: row.enabled === 1,
      ...(row.last_scan_at ? { lastScanAt: row.last_scan_at } : {}),
      ...(row.last_error ? { lastError: row.last_error } : {}),
    }))
  }

  /**
   * The catalogue's foreign keys point at a `sources` row, so the source the
   * scanner writes under has to exist before any track does. The scanner
   * creates it because the scanner is the writer; `plugin-source-local` reads
   * the same rows and needs no say in it.
   *
   * Local files are the one source that is **not** an imported document
   * (docs/06 §12) — there is no HTTP to describe — so this writes the minimal
   * row the FKs need. `doc_json` is a real document all the same: it round
   * trips through export like any other, and says plainly what it is.
   */
  private async ensureSourceRow(): Promise<void> {
    const id = this.config.sourceId
    const doc = JSON.stringify({
      sourceUrl: `bbebee://local/${id}`,
      sourceName: 'This device',
      sourceComment: 'Files on this device. Managed by the scanner, not imported.',
    })
    await this.ownCtx.db.exec(
      `INSERT INTO sources (id, source_url, name, source_type, doc_json, doc_hash,
                            enabled, imported_at, updated_at)
       VALUES (?, ?, 'This device', 'music', ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [id, `bbebee://local/${id}`, doc, `local-${id}`, Date.now(), Date.now()],
    )
  }
}

function extensionOf(uri: string): string | undefined {
  const name = uri.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined
}

export const name = 'plugin-local-scanner'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.scanner` is usable.
 */
export async function apply(ctx: Context, config: ScannerConfig = {}) {
  ctx.logger.info('plugin-local-scanner: loaded')
  const fiber = await ctx.plugin(Scanner, config)
  return () => void fiber.dispose()
}

export default { name, apply }
export { importTrack, forgetFile, splitArtists, sortKey } from './import.js'
export { trackId, albumId, artistId, artworkId } from './ids.js'