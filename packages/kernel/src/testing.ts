/**
 * Testing utilities.
 *
 * `snapshotContext` exists to make the architecture's central claim
 * *executable*: a plugin, when disabled, leaves nothing behind. Run it over
 * every plugin in the workspace and a leak fails CI rather than surfacing
 * months later as a mystery listener firing into a disposed context.
 *
 * See docs/09-project-structure.md §6.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import type { EffectMeta } from 'cordis'
import { fiberStateName } from './fiber-state.js'

export interface ContextSnapshot {
  /** Event name → listener count. */
  hooks: Record<string, number>
  /** Service keys currently provided. */
  services: string[]
  /** Labelled effect tree of the root fiber. */
  effects: EffectMeta[]
  /** Number of plugin runtimes registered. */
  runtimes: number
}

/**
 * Capture everything a plugin could leak.
 *
 * Reaches into two Cordis internals — `events._hooks` and `reflect.store` —
 * because neither has a public accessor. They are asserted by
 * `kernel/src/cordis-assumptions.test.ts`, so an upstream rename fails there
 * with a pointed message rather than silently making this return `{}`.
 */
export function snapshotContext(ctx: Context): ContextSnapshot {
  const events = ctx.events as unknown as { _hooks: Record<string, unknown[]> }
  const reflect = ctx.reflect as unknown as { store: Record<string | symbol, unknown> }

  const hooks: Record<string, number> = {}
  for (const [name, list] of Object.entries(events._hooks ?? {})) {
    if (!Array.isArray(list) || list.length === 0) continue
    hooks[name] = list.length
  }

  const services = Object.getOwnPropertySymbols(reflect.store ?? {})
    .map((s) => String(s))
    .sort()

  return {
    hooks,
    services,
    effects: ctx.fiber.getEffects(),
    runtimes: ctx.registry.size,
  }
}

/**
 * Difference between two snapshots, or `undefined` when they match.
 *
 * ⚠️ **A tripwire, not a proof.** Hooks are compared by count per event name
 * and effects by count alone, so a run that removes one listener and leaks
 * another on the same event nets to zero and passes. It reliably catches the
 * common case — a plugin that forgot to register a disposer — and should be
 * read as "no obvious leak", never as "no leak".
 */
export function diffSnapshots(
  before: ContextSnapshot,
  after: ContextSnapshot,
): string[] | undefined {
  const problems: string[] = []

  for (const [name, count] of Object.entries(after.hooks)) {
    const prior = before.hooks[name] ?? 0
    if (count > prior) {
      problems.push(`leaked ${count - prior} listener(s) on "${name}"`)
    }
  }

  const priorServices = new Set(before.services)
  for (const s of after.services) {
    if (!priorServices.has(s)) problems.push(`service still provided: ${s}`)
  }

  if (after.effects.length > before.effects.length) {
    const extra = after.effects.slice(before.effects.length).map((e) => e.label)
    problems.push(`leaked effect(s): ${extra.join(', ')}`)
  }

  if (after.runtimes > before.runtimes) {
    problems.push(`${after.runtimes - before.runtimes} plugin runtime(s) still registered`)
  }

  return problems.length ? problems : undefined
}

/**
 * Assert that loading and disposing `run` leaves the context as it was found.
 *
 * ```ts
 * await expectNoLeak(ctx, () => ctx.plugin(MyPlugin, config))
 * ```
 */
export async function expectNoLeak(
  ctx: Context,
  run: () => PromiseLike<{ dispose: () => Promise<void> }>,
): Promise<void> {
  const before = snapshotContext(ctx)
  const fiber = await run()
  await fiber.dispose()
  await tick()

  const problems = diffSnapshots(before, snapshotContext(ctx))
  if (problems) {
    throw new Error(`plugin did not unload cleanly:\n  - ${problems.join('\n  - ')}`)
  }
}

/**
 * Let Cordis's scheduled work settle.
 *
 * Must yield a **macrotask**, not a few microtasks: `Fiber._reload` awaits an
 * intermediate promise and chains through `inertia`, so an unload-then-reload
 * cycle does not complete within any fixed number of `Promise.resolve()`
 * turns. Draining with microtasks alone makes reload tests fail intermittently
 * — which is exactly how this was found.
 */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Readable fiber state, for assertion messages. */
export function describeFiber(fiber: { state: number; name: string }): string {
  return `${fiber.name}: ${fiberStateName(fiber.state)}`
}

/** A bare context with no core services, for unit tests. */
export function createTestContext(): Context {
  return new Context()
}

/**
 * A scratch directory that the suite actually cleans up.
 *
 * Every harness in the workspace called `mkdtemp(join(tmpdir(), 'bbebee-…'))`
 * and nothing ever removed the result. About 400 directories accumulated per
 * full run; after a handful of runs `/tmp` was full, and the suite then failed
 * with `ENOSPC` from whichever test happened to allocate next — a failure that
 * points at an innocent test and says nothing about the cause.
 *
 * Directories land under one per-run root that `vitest.global.ts` removes when
 * the run ends, so cleanup does not depend on a test reaching its own teardown
 * — which is exactly what a failing test does not do.
 */
export async function tempDir(prefix: string): Promise<string> {
  const root = process.env.BBEBEE_TEST_TMP ?? tmpdir()
  return mkdtemp(join(root, `${prefix}-`))
}
