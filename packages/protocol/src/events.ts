/**
 * The typed event map.
 *
 * The dispatch mode is part of the contract, because it determines whether a
 * listener can block, transform, or veto:
 *
 *   emit      fire-and-forget notification; listener errors never reach the emitter
 *   parallel  all listeners awaited; one failing does not block the others
 *   serial    ordered; the first non-nullish return short-circuits
 *   waterfall middleware — listeners transform the value and control `next`
 *
 * ⚠️ **`next` takes no arguments.** Cordis closes it over the original
 * argument list, so `next(somethingElse)` is silently the same as `next()`.
 * A listener therefore has exactly two moves: **mutate the argument in place**
 * (rewrite `req.headers`, splice the array) and call `next()`, or
 * **short-circuit** by returning a value and never calling `next` at all.
 * Pinned by `cordis-assumptions.test.ts`, because an upgrade that changed it
 * would otherwise be found by a plugin author debugging a header that
 * vanished.
 *
 * The waterfall hooks are the composition mechanism of the whole architecture:
 * they are how `plugin-download` substitutes a local file for a stream URL
 * without `ctx.player` knowing downloads exist. See docs/02 §5, docs/07 §5.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { PlayRecord, QueueItem, TransportState } from './entities/playback.js'
import type { StreamHandle, StreamPrefs } from './entities/media.js'
import type { EffectSegment, ChainEntry } from './services/audio.js'
import type { HttpRequest, HttpResponse } from './services/http.js'
import type { AuthStatus } from './services/sources.js'
import type { CheckReport } from './services/source-document.js'
import type { SourceError } from './errors.js'
import type { UrnKind } from './urn.js'

declare module 'cordis' {
  interface Events {
    /* ── player ─────────────────────────────────────── emit ── */
    'player/state-changed'(state: TransportState): void
    'player/track-changed'(trackUrn: string | undefined, previous?: string): void
    /** Throttled to 1 Hz. The UI interpolates between ticks. */
    'player/position'(positionMs: number, durationMs: number): void
    'player/error'(error: SourceError, trackUrn: string): void

    /* ── player ─────────────────────────────────── parallel ── */
    'player/track-completed'(play: PlayRecord): void

    /* ── player ────────────────────────────────── waterfall ── */
    /**
     * Decide what actually gets played.
     *
     * `plugin-download` hooks this to substitute a local file when a binding
     * exists; `plugin-failover` hooks it to retry the same recording on
     * another source when this one is unavailable or its rules have rotted.
     */
    'player/before-resolve'(
      urn: string,
      prefs: StreamPrefs,
      next: () => Promise<StreamHandle>,
    ): Promise<StreamHandle>
    'player/before-enqueue'(urns: string[], next: () => void): void

    /* ── queue ──────────────────────────────────────── emit ── */
    'queue/changed'(items: readonly QueueItem[]): void

    /* ── sources ────────────────────────────────────── emit ── */
    'source/registered'(sourceId: string): void
    'source/unregistered'(sourceId: string): void
    'source/authenticated'(sourceId: string, status: AuthStatus): void
    'source/unreachable'(sourceId: string, error: SourceError): void

    /* ── sources: the document itself ───────────────── emit ── */
    /** One or more documents were imported. The runtime starts their fibers. */
    'source/imported'(sourceIds: string[]): void
    /** A stored document changed. The runtime rebuilds exactly that fiber. */
    'source/changed'(sourceId: string, changedFields: string[]): void
    'source/removed'(sourceId: string, forgotCatalogue: boolean): void
    /**
     * A rule produced nothing where something was required.
     *
     * Coalesced per source: one rotted source can fail a rule per track in a
     * queue, and the stale badge needs the fact, not the volume.
     */
    'source/rule-failed'(sourceId: string, rule: { block: string; field: string }): void
    'source/checked'(sourceId: string, report: CheckReport): void

    /* ── sources ──────────────────────────────────── serial ── */
    /** The session refresher gets first refusal before the UI prompts. */
    'source/auth-expired'(sourceId: string): void

    /* ── sources ────────────────────────────────── parallel ── */
    /** Listeners purge session-derived state; sign-out awaits them all. */
    'source/signed-out'(sourceId: string): void

    /* ── http ──────────────────────────────────── waterfall ── */
    /** Auth injection, retry, rate limiting, and caching all hook here. */
    'http/request'(req: HttpRequest, next: () => Promise<HttpResponse>): Promise<HttpResponse>

    /* ── downloads ──────────────────────────────────── emit ── */
    'download/queued'(taskId: string): void
    'download/progress'(taskId: string, done: number, total?: number): void
    'download/completed'(taskId: string, bindingId: string): void
    'download/failed'(taskId: string, error: Error): void

    /* ── library & scanning ─────────────────────────── emit ── */
    'library/changed'(kind: UrnKind, urns: string[]): void
    'scan/started'(rootId: string): void
    'scan/progress'(rootId: string, done: number, total?: number): void
    'scan/finished'(
      rootId: string,
      summary: { added: number; updated: number; errors: number },
    ): void

    /* ── dsp ───────────────────────────────────── waterfall ── */
    'dsp/build-chain'(segments: EffectSegment[], next: () => EffectSegment[]): EffectSegment[]
    /* ── dsp ────────────────────────────────────────── emit ── */
    'dsp/chain-changed'(chain: readonly ChainEntry[]): void

    /* ── plugins ────────────────────────────────────── emit ── */
    'plugin/loaded'(id: string): void
    'plugin/failed'(id: string, error: Error): void
    'plugin/unloaded'(id: string): void
  }
}

/** Documented dispatch mode per event, asserted by the kernel's tests. */
export type DispatchMode = 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'

export const DISPATCH_MODES = {
  'player/state-changed': 'emit',
  'player/track-changed': 'emit',
  'player/position': 'emit',
  'player/error': 'emit',
  'player/track-completed': 'parallel',
  'player/before-resolve': 'waterfall',
  'player/before-enqueue': 'waterfall',
  'queue/changed': 'emit',
  'source/registered': 'emit',
  'source/unregistered': 'emit',
  'source/authenticated': 'emit',
  'source/unreachable': 'emit',
  'source/auth-expired': 'serial',
  'source/signed-out': 'parallel',
  'http/request': 'waterfall',
  'download/queued': 'emit',
  'download/progress': 'emit',
  'download/completed': 'emit',
  'download/failed': 'emit',
  'library/changed': 'emit',
  'scan/started': 'emit',
  'scan/progress': 'emit',
  'scan/finished': 'emit',
  'dsp/build-chain': 'waterfall',
  'dsp/chain-changed': 'emit',
  'plugin/loaded': 'emit',
  'plugin/failed': 'emit',
  'plugin/unloaded': 'emit',
} as const satisfies Record<string, DispatchMode>

export type BBeBeeEventName = keyof typeof DISPATCH_MODES
