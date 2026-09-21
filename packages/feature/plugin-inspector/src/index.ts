/**
 * `ctx.inspector` — the plugin graph, as data.
 *
 * M0's last exit criterion: *the plugin inspector shows the fiber tree with
 * labelled effects*. That is not a nicety. The architecture's central claim is
 * that unloading a plugin is total, and the only way to see whether it is
 * holding anything is to look at its effect tree — so the inspector is the
 * debugging tool for the invariant everything else rests on.
 *
 * Headless by design: it produces a serialisable snapshot, and each shell
 * renders it. See docs/03-plugin-system.md §2.
 */

import { Service } from 'cordis'
import type { Context, Fiber } from 'cordis'
import { fiberStateName, type FiberStateName } from '@BBeBee/kernel'

/**
 * Whether an injected service is currently resolvable for a fiber.
 *
 * Reading `fiber.ctx[name]` is not safe here: for a *required* injection that
 * is missing, Cordis throws `cannot get required service … in inactive
 * context` rather than returning `undefined` — which is exactly the case the
 * inspector exists to display. A diagnostic tool must never throw on the
 * broken state it is diagnosing.
 */
function isAvailable(fiber: Fiber, name: string): boolean {
  try {
    return (fiber.ctx as unknown as Record<string, unknown>)[name] !== undefined
  } catch {
    return false
  }
}

/** One labelled effect, and any effects nested inside it. */
export interface EffectNode {
  label: string
  children: EffectNode[]
}

export interface FiberNode {
  /** The plugin's `name`, or 'root'/'anonymous'. */
  name: string
  /** Registration counter. `null` once disposed. */
  uid: number | null
  state: FiberStateName | 'UNKNOWN'
  /** Services this fiber declared it needs. */
  inject: string[]
  /** Injected services that are not currently available — why it is PENDING. */
  waitingFor: string[]
  /** Service keys this fiber provides. */
  provides: string[]
  effects: EffectNode[]
  children: FiberNode[]
}

export interface InspectorSnapshot {
  root: FiberNode
  /** Totals, for a header line. */
  counts: Record<FiberStateName | 'UNKNOWN', number>
  /** Fibers that are loaded but not ACTIVE, with the reason. */
  stalled: { name: string; state: string; waitingFor: string[] }[]
}

export class Inspector extends Service {
  /**
   * Warnings already emitted, so a snapshot the UI takes on every render
   * cannot turn a once-per-session fact into a log flood.
   *
   * The inspector is read repeatedly by definition — it is a live view of the
   * fiber tree — so anything it logs has to be deduplicated at the source
   * rather than by whoever is reading the file.
   */
  private readonly warned = new Set<string>()

  constructor(ctx: Context) {
    super(ctx, 'inspector')
  }

  /** Report something the tree walk should never have seen. Once. */
  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.ctx.logger.warn(`inspector: ${message}`)
  }

  /**
   * Walk the fiber tree.
   *
   * Cordis exposes fibers only through the registry (runtime → fibers), and
   * parentage through `fiber.parent.fiber`, so the tree is reconstructed by
   * grouping on the parent rather than read off directly.
   */
  snapshot(): InspectorSnapshot {
    const all = this.collect()
    const rootFiber = this.ctx.registry.ctx.root.fiber

    const childrenOf = new Map<Fiber, Fiber[]>()
    for (const fiber of all) {
      const parent = fiber.parent?.fiber
      if (!parent || parent === fiber) continue
      const siblings = childrenOf.get(parent) ?? []
      siblings.push(fiber)
      childrenOf.set(parent, siblings)
    }

    const counts = {
      PENDING: 0,
      LOADING: 0,
      ACTIVE: 0,
      FAILED: 0,
      DISPOSED: 0,
      UNLOADING: 0,
      UNKNOWN: 0,
    } as Record<FiberStateName | 'UNKNOWN', number>
    const stalled: InspectorSnapshot['stalled'] = []

    const build = (fiber: Fiber, depth: number): FiberNode => {
      const state = fiberStateName(fiber.state)
      counts[state]++

      /*
       * A state this build has no name for means Cordis's own state values
       * moved under us — `cordis` is pinned at an rc for exactly this reason
       * (docs/09 §5). The inspector still renders, marking the fiber UNKNOWN;
       * without this line that drift shows up only as a badge nobody reads,
       * on the tool the architecture's central claim is checked with.
       */
      if (state === 'UNKNOWN') {
        this.warnOnce(
          `state:${String(fiber.state)}`,
          `cordis reported fiber state ${String(fiber.state)}, which this build has no name for`,
        )
      }

      const inject = Object.keys(fiber.inject ?? {})
      const waitingFor = inject.filter((n) => !isAvailable(fiber, n))
      if (state !== 'ACTIVE' && fiber.uid !== null) {
        stalled.push({ name: fiber.name, state, waitingFor })
      }

      let effects: EffectNode[]
      try {
        effects = (fiber.getEffects?.() ?? []) as EffectNode[]
      } catch {
        effects = []
      }

      return {
        name: fiber.name,
        uid: fiber.uid,
        state,
        inject,
        waitingFor,
        provides: this.providedBy(fiber),
        effects,
        // Depth guard: a cycle in `parent` would otherwise hang the inspector,
        // and a debugging tool that hangs is worse than none. Truncating
        // silently is nearly as bad — the tree then *looks* complete — so the
        // one place it can happen says so.
        children:
          depth > 32
            ? (this.warnOnce(
                'depth',
                `fiber tree deeper than 32 at '${fiber.name}'; truncating — this is a cycle in parentage`,
              ),
              [])
            : (childrenOf.get(fiber) ?? []).map((c) => build(c, depth + 1)),
      }
    }

    this.ctx.logger.debug(
      'inspector: snapshot taken (%d fibers, %d stalled)',
      all.length,
      stalled.length,
    )
    return { root: build(rootFiber, 0), counts, stalled }
  }

  /** Every fiber Cordis currently knows about. */
  private collect(): Fiber[] {
    const out: Fiber[] = []
    try {
      for (const runtime of this.ctx.registry.values()) {
        for (const fiber of runtime.fibers) out.push(fiber)
      }
    } catch {
      // Return collected so far if registry mutates during collect
    }
    return out
  }

  /** Service keys whose implementation belongs to this fiber. */
  private providedBy(fiber: Fiber): string[] {
    try {
      const store = (this.ctx.reflect as unknown as { store?: Record<symbol, { name: string; fiber: Fiber }> })
        ?.store
      if (!store) return []
      const names: string[] = []
      for (const key of Object.getOwnPropertySymbols(store)) {
        const impl = store[key]
        if (impl?.fiber === fiber && impl.name) names.push(impl.name)
      }
      return names.sort()
    } catch {
      return []
    }
  }

  /** A plain-text tree, for logs, bug reports, and the terminal. */
  render(): string {
    const snap = this.snapshot()
    const lines: string[] = []

    const walk = (node: FiberNode, prefix: string, last: boolean, root: boolean) => {
      const marker = root ? '' : last ? '└─ ' : '├─ '
      const badge = node.state === 'ACTIVE' ? '' : `  [${node.state}]`
      const waiting = node.waitingFor.length ? `  waiting: ${node.waitingFor.join(', ')}` : ''
      const provides = node.provides.length ? `  provides: ${node.provides.join(', ')}` : ''
      lines.push(`${prefix}${marker}${node.name}${badge}${provides}${waiting}`)

      const childPrefix = root ? '' : prefix + (last ? '   ' : '│  ')
      for (const effect of node.effects) {
        renderEffect(effect, `${childPrefix}${node.children.length ? '│  ' : '   '}`)
      }
      node.children.forEach((child, i) =>
        walk(child, childPrefix, i === node.children.length - 1, false),
      )
    }

    const renderEffect = (effect: EffectNode, prefix: string) => {
      lines.push(`${prefix}· ${effect.label}`)
      for (const child of effect.children) renderEffect(child, `${prefix}  `)
    }

    walk(snap.root, '', true, true)

    const summary = Object.entries(snap.counts)
      .filter(([, n]) => n > 0)
      .map(([state, n]) => `${n} ${state.toLowerCase()}`)
      .join(', ')
    lines.push('', summary)
    return lines.join('\n')
  }
}

declare module 'cordis' {
  interface Context {
    inspector: Inspector
  }
}

export const name = 'plugin-inspector'

/**
 * Awaited deliberately.
 *
 * A wrapper that fires `ctx.plugin()` without awaiting resolves immediately,
 * so `await ctx.plugin(thisPlugin)` tells a caller nothing about whether the
 * service inside is ready — its async `Service.init` may still be running.
 * Awaiting propagates readiness to whoever loaded us.
 */
export async function apply(ctx: Context) {
  ctx.logger.info('plugin-inspector: loaded')
  const fiber = await ctx.plugin(Inspector)
  return () => void fiber.dispose()
}

export default { name, apply }
