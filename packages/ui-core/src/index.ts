/**
 * `@BBeBee/ui-core` - the seam between services and React.
 *
 * Depends on `react` and `@BBeBee/protocol` and nothing else, so both kits
 * build on the same hooks and a feature's *state* logic is written once even
 * though its pixels are written twice (docs/08 4).
 *
 * The rule this layer exists to enforce: **React holds no domain state.**
 * Services own it; components subscribe. Anything here that starts looking
 * like a reducer belongs in a service.
 */

import { useCallback, useDebugValue, useMemo, useSyncExternalStore } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { createServiceStore, type StoreOptions } from './store.js'

export * from './props.js'
export * from './store.js'

/**
 * Read a service off the context, or `undefined` where it is not loaded.
 *
 * `undefined` is a normal state, not an error: a plugin may be disabled, or a
 * service may not exist on this platform, and a view that renders a
 * placeholder is the behaviour docs/08 3 asks for.
 */
export function useService(ctx: Context, key: string): unknown {
  const value = (ctx as unknown as Record<string, unknown>)[key]
  useDebugValue(value === undefined ? `${key} (absent)` : key)
  return value
}

/**
 * Subscribe to service state.
 *
 * `select` runs on every notification and on every render, so it must be
 * cheap. It does **not** have to be referentially stable - the store caches
 * and compares, which is what keeps a selector that builds an array from
 * looping React forever (see `store.ts`).
 *
 * `events` and `select` are read on first render and whenever `deps` changes.
 * Passing a fresh inline `select` every render is fine and expected.
 */
export function useServiceState<T>(
  ctx: Context,
  events: readonly string[],
  select: () => T,
  options: StoreOptions<T> & { deps?: readonly unknown[] } = {},
): T {
  const { isEqual, deps } = options
  // The store must survive re-renders, or every render resubscribes and the
  // cache - the thing preventing the render loop - is thrown away each time.
  //
  // `select` is deliberately excluded from the dependencies: it is inline at
  // nearly every call site, so including it would rebuild the store on every
  // render and undo the caching. `deps` is how a caller says the selection
  // itself changed.
  const key = events.join(' ')
  const store = useMemo(
    () => createServiceStore(ctx, events, select, isEqual ? { isEqual } : {}),
    [ctx, key, isEqual, ...(deps ?? [])],
  )
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store])
  // The third argument is the server snapshot; the same read is correct
  // because there is no server - but omitting it throws during hydration if a
  // shell ever renders on one.
  return useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot)
}

/**
 * The state of a service call, for a view that must show a spinner.
 *
 * Deliberately *not* a data-fetching library. It exists so a view can report
 * loading and failure without inventing its own `useEffect`, which docs/08 4
 * forbids for domain work.
 */
export interface AsyncState<T> {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data?: T
  error?: Error
}

export function isReady<T>(state: AsyncState<T>): state is AsyncState<T> & { data: T } {
  return state.status === 'ready'
}
