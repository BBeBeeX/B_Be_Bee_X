/**
 * What the mobile shell runs — as data, importing nothing.
 *
 * Separate from `boot.ts` because `boot.ts` reaches for `react-native` and
 * every Expo module, and this has to be readable by a test that does neither.
 * The registry is generated from the manifests; *this* is the allowlist, and
 * configuration is the allowlist: a package being bundled is not on its own
 * enough to run it (docs/03 §6.4).
 *
 * The list below is deliberately the same as the desktop shell's, minus the
 * per-target view packages. If the two ever diverge in *features* rather than
 * in views, that is ADR-2's split UI having become a split product — the last
 * entry in docs/10's "what would make this design wrong".
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
  'secrets',
  'device',
  'background',
  'mediaSession',
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

  // M1's feature set, identical to desktop's. Load order is derived from
  // `inject`, never declared here (docs/02 §3).
  '@BBeBee/plugin-sources': {},
  '@BBeBee/plugin-sources-ui-mobile': {},
  '@BBeBee/plugin-local-scanner': {},
  '@BBeBee/plugin-local-scanner-ui-mobile': {},
  '@BBeBee/plugin-source-local': {},
  '@BBeBee/plugin-source-runtime': {},
  '@BBeBee/plugin-player': {},
  '@BBeBee/plugin-player-ui-mobile': {},
}
