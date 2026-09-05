/**
 * `ctx.js` on QuickJS — a real realm, not a `vm` context.
 *
 * The distinction is the whole point. `node:vm` shares an object graph with
 * the host: a script that reaches `this.constructor.constructor` is out, and
 * every published mitigation for that is a blocklist someone eventually walks
 * around. QuickJS is a separate interpreter compiled to WebAssembly — there is
 * no host object graph to reach, because there are no host objects in it. What
 * crosses the boundary crosses as data.
 *
 * That buys three things the source model needs (docs/06 §8):
 *
 *  - **Interruptible.** A `while(1)` is stopped by an interrupt handler the
 *    host polls. Nothing in JavaScript's own semantics can do this, which is
 *    why `source-rules` has to refuse catastrophic regexes rather than time
 *    them out.
 *  - **Bounded memory.** A per-realm heap ceiling, enforced by the allocator.
 *  - **Nothing ambient.** No `fetch`, no `require`, no timers. A realm reaches
 *    exactly the host functions the caller exposed and nothing else.
 *
 * ⚠️ The sandbox bounds *reach*, not *intent*. A script still sees everything
 * passed in and can send it anywhere an exposed function allows, which is why
 * the source runtime pairs this with a per-source egress allowlist.
 *
 * See docs/04-core-services.md §19.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import {
  DEFAULT_JS_LIMITS,
  JsBridgeError,
  JsMemoryError,
  JsRealmDisposedError,
  JsScriptError,
  JsTimeoutError,
} from '@BBeBee/protocol'
import type { Disposable, JsLimits, JsRealm, JsService } from '@BBeBee/protocol'
import { getQuickJS, type QuickJSContext, type QuickJSHandle, type QuickJSWASMModule } from 'quickjs-emscripten'

export interface JsQuickJsConfig {
  /** Applied where a caller does not override. */
  limits?: Partial<JsLimits>
}

export class JsQuickJsNode extends Service implements JsService {
  readonly engine = { name: 'quickjs-emscripten', version: '0.32.0' }

  private module!: QuickJSWASMModule
  /** Every live realm, so unloading the service cannot leak a native handle. */
  private readonly realms = new Set<QuickJsRealm>()

  constructor(
    ctx: Context,
    private readonly config: JsQuickJsConfig = {},
  ) {
    super(ctx, 'js')
  }

  async [Service.init]() {
    // One WASM module for the process; realms are cheap, the module is not.
    this.module = await getQuickJS()

    // A realm outliving the service is a leaked WASM allocation that nothing
    // will ever free. Copied first: `dispose()` removes from the set.
    return () => {
      for (const realm of [...this.realms]) realm.dispose()
    }
  }

  async createRealm(limits: Partial<JsLimits> = {}): Promise<JsRealm> {
    const resolved: JsLimits = { ...DEFAULT_JS_LIMITS, ...this.config.limits, ...limits }
    const realm = new QuickJsRealm(this.module, resolved, () => this.realms.delete(realm))
    this.realms.add(realm)
    return realm
  }
}

/** Why a realm stopped being usable. `undefined` means it still is. */
type Poison = 'disposed' | 'timeout' | 'memory'

class QuickJsRealm implements JsRealm {
  private vm: QuickJSContext | undefined
  private poison: Poison | undefined
  /**
   * Set while an eval is running, so the interrupt handler knows its deadline.
   *
   * On the realm rather than in a closure because `preload` and `eval` share
   * one handler — installing a second would replace the first, and a `jsLib`
   * with an infinite loop would then run unbounded.
   */
  private deadline = 0
  private readonly disposers = new Set<() => void>()

  constructor(
    module: QuickJSWASMModule,
    private readonly limits: JsLimits,
    private readonly onDispose: () => void,
  ) {
    const runtime = module.newRuntime()
    runtime.setMemoryLimit(limits.memoryBytes)
    /*
     * Two ceilings, not one. `setMemoryLimit` caps the heap; the stack cap
     * catches unbounded recursion, which exhausts the *native* stack and
     * would take the host process down with it rather than throwing.
     */
    runtime.setMaxStackSize(512 * 1024)
    /*
     * The engine calls this on its own schedule while a script runs; there is
     * no exposed cycle count to tune, so it must stay cheap — it is on the hot
     * path of every loop iteration a script performs.
     */
    runtime.setInterruptHandler(() => this.deadline !== 0 && Date.now() > this.deadline)
    this.vm = runtime.newContext()
  }

  async preload(code: string): Promise<void> {
    await this.run(code)
  }

  async eval<T = unknown>(code: string, scope: Record<string, unknown> = {}): Promise<T> {
    const vm = this.live()
    // Globals, not a wrapper function: `jsLib` declares helpers at top level
    // and a rule expects to see them, so scope has to land in the same place.
    for (const [name, value] of Object.entries(scope)) {
      const handle = this.toHandle(vm, value)
      vm.setProp(vm.global, name, handle)
      handle.dispose()
    }
    return (await this.run(code)) as T
  }

  expose(name: string, fn: (...args: unknown[]) => unknown | Promise<unknown>): Disposable {
    const vm = this.live()
    const handle = vm.newFunction(name, (...args) => {
      const decoded = args.map((arg) => vm.dump(arg) as unknown)
      let result: unknown
      try {
        result = fn(...decoded)
      } catch (error) {
        // A host function throwing is the host's problem, but the script has
        // to see *something* — silently returning undefined would make a
        // failed auth call look like an empty token.
        return { error: this.toHandle(vm, String(error)) }
      }
      if (isThenable(result)) {
        /*
         * A host promise is bridged into a realm promise, and the realm's job
         * queue is pumped when it settles.
         *
         * Without the pump, a script that `await`s a host call deadlocks: the
         * promise resolves on the host side and the realm never runs the
         * continuation, because nothing asked it to. This is the single most
         * common way to get a QuickJS embedding wrong, which is why the
         * contract calls it out.
         */
        const deferred = vm.newPromise()
        void result.then(
          (value) => {
            if (this.vm !== vm) return
            const h = this.toHandle(vm, value)
            deferred.resolve(h)
            h.dispose()
            vm.runtime.executePendingJobs()
          },
          (error: unknown) => {
            if (this.vm !== vm) return
            const h = this.toHandle(vm, String(error))
            deferred.reject(h)
            h.dispose()
            vm.runtime.executePendingJobs()
          },
        )
        return deferred.handle
      }
      return this.toHandle(vm, result)
    })
    vm.setProp(vm.global, name, handle)
    handle.dispose()

    const remove = () => {
      if (this.vm !== vm) return
      vm.setProp(vm.global, name, vm.undefined)
    }
    this.disposers.add(remove)
    // `Disposable` is a bare function in this protocol, not `{ dispose() }`.
    return () => {
      this.disposers.delete(remove)
      remove()
    }
  }

  dispose(): void {
    // Idempotent by contract: a disposer may legitimately run from a fiber
    // teardown *and* an explicit call, and the second must not throw.
    const vm = this.vm
    if (!vm) return
    this.vm = undefined
    this.poison ??= 'disposed'
    this.disposers.clear()
    const runtime = vm.runtime
    vm.dispose()
    runtime.dispose()
    this.onDispose()
  }

  /* ── internals ──────────────────────────────────────────────────────── */

  private live(): QuickJSContext {
    if (!this.vm) throw new JsRealmDisposedError(this.poison ?? 'disposed')
    return this.vm
  }

  /**
   * Run code with the limits armed, and translate what comes back.
   *
   * A realm that breached a limit is **poisoned**: QuickJS's state after an
   * interrupt is undefined — a half-finished frame, a lock never released —
   * so continuing to use it is how a sandbox turns into a crash months later.
   * The realm is torn down and every later call rejects.
   */
  private async run(code: string): Promise<unknown> {
    const vm = this.live()
    this.deadline = Date.now() + this.limits.timeoutMs

    let result: ReturnType<QuickJSContext['evalCode']>
    try {
      result = vm.evalCode(code)
    } catch (error) {
      // A throw from `evalCode` itself is the memory limit: the allocator
      // fails inside the engine rather than producing an error value.
      this.poisonWith('memory')
      throw wrapOutOfMemory(error, this.limits)
    } finally {
      this.deadline = 0
    }

    if (result.error) {
      const detail = vm.dump(result.error) as unknown
      result.error.dispose()
      // An interrupt surfaces as an error with no message QuickJS wrote —
      // telling it apart from a script's own throw is what makes "your rule
      // is wrong" different from "your rule is too slow".
      if (isInterrupt(detail)) {
        this.poisonWith('timeout')
        throw new JsTimeoutError(this.limits.timeoutMs)
      }
      if (isOutOfMemory(detail)) {
        this.poisonWith('memory')
        throw new JsMemoryError(this.limits.memoryBytes)
      }
      throw scriptError(detail)
    }

    // Pending jobs first: a script whose completion value is a promise has
    // not settled it yet, and dumping the handle would give a pending one.
    vm.runtime.executePendingJobs()
    const settled = await this.settle(vm, result.value)
    result.value.dispose()
    return settled
  }

  /**
   * Await a realm promise from the host side, pumping the realm as it goes.
   *
   * `jsLib` helpers routinely `await` a host call, so the completion value of
   * a rule is a promise more often than not.
   *
   * ⚠️ Ownership: this frees only handles it did not receive. Asking QuickJS
   * for the promise state of a *non*-promise hands back a fulfilled state
   * carrying the very same handle (`notAPromise`), so disposing it here as
   * well as in the caller is a double free — which surfaces as
   * `QuickJSUseAfterFree` from somewhere unrelated, several calls later.
   */
  private async settle(vm: QuickJSContext, handle: QuickJSHandle): Promise<unknown> {
    const initial = vm.getPromiseState(handle)
    if (initial.type === 'fulfilled' && initial.notAPromise) {
      return this.bounded(vm.dump(handle) as unknown)
    }

    if (initial.type === 'pending') {
      const until = Date.now() + this.limits.timeoutMs
      for (;;) {
        vm.runtime.executePendingJobs()
        if (vm.getPromiseState(handle).type !== 'pending') break
        if (Date.now() > until) {
          this.poisonWith('timeout')
          throw new JsTimeoutError(this.limits.timeoutMs)
        }
        // Yield to the host loop so a pending host promise can settle.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    const state = vm.getPromiseState(handle)
    if (state.type === 'rejected') {
      const detail = vm.dump(state.error) as unknown
      state.error.dispose()
      throw scriptError(detail)
    }
    if (state.type === 'fulfilled') {
      const value = vm.dump(state.value) as unknown
      // Only if it is a handle of its own; `notAPromise` means it is ours.
      if (!state.notAPromise) state.value.dispose()
      return this.bounded(value)
    }
    return this.bounded(vm.dump(handle) as unknown)
  }

  private poisonWith(reason: Poison): void {
    this.poison = reason
    this.dispose()
    this.poison = reason
  }

  /**
   * A value on its way out, size-checked.
   *
   * `maxResultBytes` is not about memory — the heap ceiling covers that — but
   * about what crosses into the host, where it is no longer bounded by
   * anything. A rule returning a 200MB string would otherwise become a 200MB
   * string in the app.
   */
  private bounded(value: unknown): unknown {
    let json: string | undefined
    try {
      json = JSON.stringify(value)
    } catch {
      throw new JsBridgeError('the script returned a value that cannot cross the boundary')
    }
    if (json !== undefined && json.length > this.limits.maxResultBytes) {
      throw new JsBridgeError(
        `the script returned ${json.length} bytes, over the ${this.limits.maxResultBytes}-byte limit`,
      )
    }
    return value
  }

  /** Host value → realm handle, as data. Never a live host reference. */
  private toHandle(vm: QuickJSContext, value: unknown): QuickJSHandle {
    switch (typeof value) {
      case 'undefined':
        return vm.undefined
      case 'boolean':
        return value ? vm.true : vm.false
      case 'number':
        return vm.newNumber(value)
      case 'string':
        return vm.newString(value)
      case 'bigint':
        // No BigInt bridge: silently narrowing to a Number would corrupt an
        // id past 2^53, which is exactly what a backend uses them for.
        throw new JsBridgeError('a BigInt cannot cross into the realm')
      case 'function':
      case 'symbol':
        throw new JsBridgeError(`a ${typeof value} cannot cross into the realm`)
      default:
        break
    }
    if (value === null) return vm.null

    if (Array.isArray(value)) {
      const array = vm.newArray()
      for (const [i, entry] of value.entries()) {
        const handle = this.toHandle(vm, entry)
        vm.setProp(array, i, handle)
        handle.dispose()
      }
      return array
    }

    const object = vm.newObject()
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue
      const handle = this.toHandle(vm, entry)
      vm.setProp(object, key, handle)
      handle.dispose()
    }
    return object
  }
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Whether a dumped error is an interrupt rather than a script's own throw.
 *
 * QuickJS reports it as `InternalError: interrupted`, and there is no
 * structured marker to test instead.
 */
function isInterrupt(detail: unknown): boolean {
  const text = messageOf(detail)
  return /interrupt/i.test(text)
}

function isOutOfMemory(detail: unknown): boolean {
  return /out of memory|allocation failed/i.test(messageOf(detail))
}

function messageOf(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const { name, message } = detail as { name?: unknown; message?: unknown }
    return `${typeof name === 'string' ? name : ''}: ${typeof message === 'string' ? message : ''}`
  }
  return String(detail)
}

function wrapOutOfMemory(error: unknown, limits: JsLimits): Error {
  if (isOutOfMemory(error) || /memory/i.test(String(error))) {
    return new JsMemoryError(limits.memoryBytes)
  }
  return error instanceof Error ? error : new Error(String(error))
}

/** A script's own throw, with its realm-side stack kept as untrusted text. */
function scriptError(detail: unknown): JsScriptError {
  if (detail && typeof detail === 'object') {
    const { message, stack } = detail as { message?: unknown; stack?: unknown }
    return new JsScriptError(
      typeof message === 'string' ? message : messageOf(detail),
      typeof stack === 'string' ? stack : undefined,
    )
  }
  return new JsScriptError(String(detail))
}

export default JsQuickJsNode
