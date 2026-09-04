/**
 * `ctx.scanner` — the local filesystem walk.
 *
 * Separate from `plugin-source-local` because scanning is a different concern
 * from serving: one fills the catalogue from files on disk, the other answers
 * questions about what is in it. See docs/06-music-sources.md §8.
 *
 * docs/03 §2 illustrates cancellation with `ctx.library.scan({ signal })`.
 * That was about the shape of a cancellable effect, not about ownership — the
 * shape is `ScannerService.scan` below.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Uri } from '../common.js'

export interface ScanRoot {
  id: string
  uri: Uri
  recursive: boolean
  enabled: boolean
  /** Epoch ms of the last completed scan. */
  lastScanAt?: number
  lastError?: string
}

export interface ScanSummary {
  added: number
  updated: number
  /** Files that are gone: their binding, and any track left with none, go too. */
  removed: number
  /** Files that would not decode. Recorded with a reason, never silently dropped. */
  errors: number
  /** True when the walk was cancelled before it finished. */
  cancelled?: boolean
  /**
   * True when the walk stopped early — cancelled, or bounded by the depth cap
   * or directory budget that a symlink loop trips.
   *
   * ⚠️ Load-bearing, not informational. A scan that did not see everything
   * **must not remove anything**: "absent from the walk" and "gone from disk"
   * are indistinguishable on a partial view, and reconciling on one deletes
   * the rows of files still sitting on disk. A consumer showing "N removed"
   * should say the scan was incomplete instead.
   */
  incomplete?: boolean
}

export interface ScanProgress {
  rootId: string
  done: number
  /** Absent until the walk has enumerated the tree. */
  total?: number
}

export interface ScannerService {
  readonly roots: readonly ScanRoot[]

  /**
   * Add a folder to scan.
   *
   * The Uri must already carry durable permission — on Android that means it
   * came from `ctx.fs.pickDirectory()`, whose SAF grant is persisted.
   */
  addRoot(uri: Uri, opts?: { recursive?: boolean }): Promise<ScanRoot>

  /** `forgetTracks` also drops the catalogue rows this root produced. */
  removeRoot(id: string, opts?: { forgetTracks?: boolean }): Promise<void>
  setEnabled(id: string, on: boolean): Promise<void>

  /**
   * Walk the roots, importing what changed.
   *
   * Incremental by `(size, mtime)`: an unchanged file costs one `stat` and
   * nothing else. `full` re-reads metadata regardless, for when the tag reader
   * itself has changed.
   */
  scan(opts?: { rootId?: string; full?: boolean; signal?: AbortSignal }): Promise<ScanSummary>

  /** Cancel the walk in flight. It checkpoints per batch, so this costs one batch. */
  cancel(): void

  readonly progress: ScanProgress | undefined
}

declare module 'cordis' {
  interface Context {
    scanner: ScannerService
  }
}
