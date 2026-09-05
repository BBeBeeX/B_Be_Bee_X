/**
 * `ctx.js` — the sandboxed evaluator.
 *
 * Evaluate a snippet of untrusted JavaScript and get a value back, in a realm
 * that shares nothing with the app. It exists for exactly one caller today:
 * `plugin-source-runtime`, whose rules are written by strangers.
 *
 * It is a *core* service rather than part of that plugin because embedding an
 * interpreter means shipping native code, and only `core-*` may do that.
 *
 * ⚠️ **The sandbox bounds reach, not intent.** Code in a realm still sees
 * everything the host passes in and can send it wherever the host's exposed
 * functions allow — which is why the source runtime pairs this with a
 * per-source host allowlist on `ctx.http`. An evaluator without an egress
 * limit is a containment story with a hole in the middle.
 *
 * See docs/04-core-services.md §19 and docs/06-music-sources.md §8.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable } from '../common.js'

export interface JsLimits {
  /**
   * Wall clock for one uninterrupted stretch of engine execution.
   *
   * ⚠️ **Not the whole call.** A script that `await`s hands control back, and
   * each continuation is a fresh stretch — so this is what bounds *loops*,
   * which is what it is for. An implementation that armed it only around the
   * initial evaluation would leave every continuation unbounded, which is a
   * freeze rather than a timeout. The call as a whole is bounded by
   * `budgetMs`.
   */
  timeoutMs: number
  /**
   * Wall clock for one `eval`, including everything it awaits.
   *
   * A rule that makes network calls legitimately takes longer than one that
   * does not, so this is the larger of the two (docs/06 §8). Without it a
   * script could yield for ever in individually-legal slices.
   */
  budgetMs: number
  /** Heap ceiling. Exceeding it throws `JsMemoryError`. */
  memoryBytes: number
  /** Cap on a returned value's size, measured before cloning. */
  maxResultBytes: number
}

export const DEFAULT_JS_LIMITS: JsLimits = {
  timeoutMs: 2_000,
  // docs/06 §8's "10s with network": a rule fetching three pages is doing its
  // job; one still going after ten seconds is not.
  budgetMs: 10_000,
  memoryBytes: 32 * 1024 * 1024,
  maxResultBytes: 1024 * 1024,
}

/** A script threw. Distinct from a limit breach, which is not the author's bug. */
export class JsScriptError extends Error {
  override readonly name = 'JsScriptError'
  constructor(
    message: string,
    /** The realm-side stack, if the engine could produce one. Untrusted text. */
    readonly scriptStack?: string,
  ) {
    super(message)
  }
}

export interface JsRealm {
  /**
   * Evaluate `code` with `scope` bound as globals.
   *
   * Resolves with the completion value, **structured-cloned out of the
   * realm** — never a live reference into it. Nothing inside can retain a host
   * object, which is the failure that makes same-realm "sandboxes" worthless.
   */
  eval<T = unknown>(code: string, scope?: Record<string, unknown>): Promise<T>

  /**
   * Install a host function callable from inside.
   *
   * Arguments arrive **structured-cloned and unvalidated** — they are whatever
   * the script passed, so the host function validates its own inputs. The
   * parameter type is `unknown[]`, not `never[]`: `never[]` would let a host
   * function declare `(url: string)` and be silently wrong at runtime.
   *
   * ⚠️ A returned promise is awaited by driving the realm's job queue. The
   * implementation must pump that queue while awaiting, or a script that
   * awaits a host call deadlocks — the single most common way to get a QuickJS
   * embedding wrong.
   */
  expose(name: string, fn: (...args: unknown[]) => unknown | Promise<unknown>): Disposable

  /**
   * Evaluate once at realm creation — a source document's `jsLib`.
   *
   * Ordering is part of the contract: every `preload` completes, in call
   * order, before the first `eval` runs. A `jsLib` that defines a helper the
   * first rule uses would otherwise fail intermittently.
   */
  preload(code: string): Promise<void>

  /**
   * Dispose the realm and its native handle.
   *
   * **`dispose()` itself is idempotent** — calling it twice is a no-op, not an
   * error, because a disposer may legitimately run from both a fiber teardown
   * and an explicit call. It returns `void` and never throws.
   *
   * **Every other method** on a disposed realm rejects with
   * `JsRealmDisposedError` rather than crashing or, worse, resurrecting it.
   * The two rules are about different methods and are easy to conflate; an
   * implementation that got them backwards would be silently
   * non-interchangeable with one that did not.
   *
   * Registered through `ctx.effect()` by the caller, so a leaked realm is a
   * leaked native handle the leak test catches.
   */
  dispose(): void
}

export interface JsService {
  /**
   * A fresh realm with ECMAScript builtins and nothing else.
   *
   * A realm that breached a limit is **poisoned**: its state after an
   * interrupt is undefined, so the implementation must reject every later
   * `eval` on it rather than continue. Callers create a new realm; they do not
   * retry into the old one.
   */
  createRealm(limits?: Partial<JsLimits>): Promise<JsRealm>
  /**
   * Reported so a rule can branch on it and a trace can record it. Two QuickJS
   * builds are not identical, and a source that works on desktop but not on
   * mobile must be debuggable rather than mysterious.
   */
  readonly engine: { name: string; version: string }
}

export class JsTimeoutError extends Error {
  override readonly name = 'JsTimeoutError'
  constructor(readonly timeoutMs: number) {
    super(`script exceeded ${timeoutMs}ms and was interrupted`)
  }
}

export class JsMemoryError extends Error {
  override readonly name = 'JsMemoryError'
  constructor(readonly memoryBytes: number) {
    super(`script exceeded its ${memoryBytes}-byte heap`)
  }
}

/** A value crossed the boundary that structured clone cannot carry. */
export class JsBridgeError extends Error {
  override readonly name = 'JsBridgeError'
}

/** The realm is gone — disposed, or poisoned by a limit breach. */
export class JsRealmDisposedError extends Error {
  override readonly name = 'JsRealmDisposedError'
  constructor(readonly reason: 'disposed' | 'timeout' | 'memory' = 'disposed') {
    super(`the realm is no longer usable (${reason})`)
  }
}

declare module 'cordis' {
  interface Context {
    js: JsService
  }
}
