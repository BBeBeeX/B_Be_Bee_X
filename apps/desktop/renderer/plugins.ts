/**
 * What the desktop shell runs — as data, importing nothing.
 *
 * Separate from `boot.ts` because `boot.ts` reaches for Electron and the
 * preload bridge, and this has to be readable by a test that does neither.
 * The registry is generated from the manifests; *this* is the allowlist, and
 * configuration is the allowlist: a package being bundled is not on its own
 * enough to run it (docs/03 §6.4).
 */

import type { AppConfig } from '@BBeBee/kernel'

/**
 * The services the bootstrap array provides.
 *
 * Load-bearing rather than documentation: `boot()` waits on exactly this list,
 * so a name here that nothing registers becomes a startup error that says
 * which service is missing — instead of a feature plugin sitting PENDING
 * forever behind a screen that renders empty for no visible reason.
 *
 * Keep it in step with the `bootstrap:` array in `boot.ts`. The conventions
 * test asserts every service a configured plugin injects is either in this
 * list or contributed by another configured plugin.
 */
export const BOOTSTRAP_SERVICES = [
  'paths',
  'fs',
  'store',
  'db',
  'device',
  'background',
  'mediaSession',
  'secrets',
  'js',
  'codec',
  'http',
  'audio',
] as const

export const ENABLED: NonNullable<AppConfig['plugins']> = {
  '@BBeBee/plugin-ui': {},
  '@BBeBee/plugin-log-console': { config: { level: 3 } },
  '@BBeBee/plugin-log-buffer': {},
  '@BBeBee/plugin-log-file': {},
  '@BBeBee/plugin-inspector': {},
  '@BBeBee/plugin-inspector-ui-desktop': {},
  '@BBeBee/plugin-hello': { config: { greeting: 'Hello' } },
  '@BBeBee/plugin-hello-ui-desktop': {},

  // M1's feature set. Load order is derived from `inject`, never declared
  // here: `plugin-player` waits for ctx.audio and ctx.sources, `plugin-source-*`
  // wait for ctx.sources, and none of them is sequenced (docs/02 §3).
  '@BBeBee/plugin-sources': {},
  '@BBeBee/plugin-sources-ui-desktop': {},
  '@BBeBee/plugin-local-scanner': {},
  '@BBeBee/plugin-local-scanner-ui-desktop': {},
  '@BBeBee/plugin-source-local': {},
  '@BBeBee/plugin-source-runtime': {},
  '@BBeBee/plugin-player': {},
  '@BBeBee/plugin-player-ui-desktop': {},
}
