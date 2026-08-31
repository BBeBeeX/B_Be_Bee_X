/**
 * `@BBeBee/protocol/conformance` — the executable form of the core-service
 * contracts.
 *
 * Every `core-*` implementation runs these, on both platforms. Without them
 * the two implementations of a service drift within a month, and each drift
 * becomes a platform-specific bug in a feature plugin that did nothing wrong.
 *
 * Usage under Vitest:
 *
 * ```ts
 * import { fsConformance } from '@BBeBee/protocol/conformance'
 *
 * describe(fsConformance.service, () => {
 *   for (const check of fsConformance.checks) {
 *     it(`${check.name} — ${check.because}`, () => check.run(subject()))
 *   }
 * })
 * ```
 */

export * from './harness.js'
export { dbConformance, type DbSubject } from './db.js'
export { fsConformance, type FsSubject } from './fs.js'
export { fsScopeConformance, type FsScopeSubject } from './fs-scope.js'
export { pathsConformance, type PathsSubject } from './paths.js'
export { storeConformance, type StoreSubject } from './store.js'
