/**
 * A mirror of Cordis's `FiberState`.
 *
 * Cordis exports `FiberState` as an ambient `const enum`, which cannot be
 * imported as a value under `isolatedModules` — and `isolatedModules` is what
 * esbuild, Metro, and Vite all effectively require. Importing it would compile
 * under `tsc` and then fail at bundle time on both of our targets.
 *
 * The numeric values are part of Cordis's public behaviour and are asserted
 * against the live runtime in `fiber-state.test.ts`, so an upstream change
 * fails a test here rather than silently mislabelling plugin states.
 */

export const FiberState = {
  PENDING: 0,
  LOADING: 1,
  ACTIVE: 2,
  FAILED: 3,
  DISPOSED: 4,
  UNLOADING: 5,
} as const

export type FiberStateValue = (typeof FiberState)[keyof typeof FiberState]

export type FiberStateName = keyof typeof FiberState

const NAMES = Object.keys(FiberState) as FiberStateName[]

/** Human-readable state, for logs and the plugin inspector. */
export function fiberStateName(state: number): FiberStateName | 'UNKNOWN' {
  return NAMES.find((n) => FiberState[n] === state) ?? 'UNKNOWN'
}

export function isActive(state: number): boolean {
  return state === FiberState.ACTIVE
}

export function isSettled(state: number): boolean {
  return (
    state === FiberState.ACTIVE ||
    state === FiberState.FAILED ||
    state === FiberState.DISPOSED
  )
}
