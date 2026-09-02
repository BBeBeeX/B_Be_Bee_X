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
  /** Wall clock for one eval. Exceeding it throws `JsTimeoutError`. */
  timeoutMs: number
  /** Heap ceiling. Exceeding it throws `JsMemoryError`. */
  memoryBytes: number
  /** Cap on a returned value's size, measured before cloning. */
  maxResultBytes: number
}

export const DEFAULT_JS_LIMITS: JsLimits = {
  timeoutMs: 2_000,
  memoryBytes: 32 * 1024 * 1024,
  maxResultBytes: 1024 * 1024,
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

  /** Install a host function callable from inside. Arguments arrive cloned. */
  expose(name: string, fn: (...args: never[]) => unknown): Disposable

  /** Evaluate once at realm creation — a source document's `jsLib`. */
  preload(code: string): Promise<void>

  /** Registered through `ctx.effect()` by the caller: this is a native handle. */
  dispose(): void
}

export interface JsService {
  /** A fresh realm with ECMAScript builtins and nothing else. */
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

declare module 'cordis' {
  interface Context {
    js: JsService
  }
}
