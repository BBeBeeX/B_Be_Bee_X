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
export { audioConformance, type AudioSubject } from './audio.js'
export { createMockAudio, type MockAudio, type MockSource } from './mock-audio.js'
export { codecConformance, type CodecSubject, type CodecSample } from './codec.js'
export { dbConformance, type DbSubject } from './db.js'
export { dbScopeConformance, type DbScopeSubject } from './db-scope.js'
export { fsConformance, type FsSubject } from './fs.js'
export { fsScopeConformance, type FsScopeSubject } from './fs-scope.js'
export { httpConformance, type HttpSubject } from './http.js'
export { jsConformance, type JsSubject } from './js.js'
export {
  mediaSessionConformance,
  type MediaSessionSubject,
} from './media-session.js'
export { pathsConformance, type PathsSubject } from './paths.js'
export { secretsConformance, type SecretsSubject } from './secrets.js'
export { storeConformance, type StoreSubject } from './store.js'
