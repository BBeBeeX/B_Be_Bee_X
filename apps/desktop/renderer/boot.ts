/**
 * The desktop bootstrap.
 *
 * This file *is* the platform-specific surface of the desktop app: a list of
 * which core services to register. Everything after it — every feature plugin,
 * every contribution — is identical to mobile (docs/02 §3).
 */

import { createApp, type App, type PluginRegistry } from '@BBeBee/kernel'
// The renderer is sandboxed, so these are IPC clients over the main-process
// host — not the node implementations, which cannot load here (docs/02 §2).
import { DbBridge, FsBridge, PathsBridge, fetchPaths } from '@BBeBee/core-desktop-bridge'
import { StoreFs } from '@BBeBee/core-store-fs'
import { DeviceElectron } from '@BBeBee/core-device-electron'
import { BackgroundElectron } from '@BBeBee/core-background-electron'
import { MediaSessionElectron } from '@BBeBee/core-media-session-electron'
import { SecretsNode } from '@BBeBee/core-secrets-node'
import { JsQuickJsNode } from '@BBeBee/core-js-quickjs-node'

import ui from '@BBeBee/plugin-ui'
import inspector from '@BBeBee/plugin-inspector'
import inspectorUi from '@BBeBee/plugin-inspector-ui-desktop'
import hello from '@BBeBee/plugin-hello'
import helloUi from '@BBeBee/plugin-hello-ui-desktop'
import logConsole from '@BBeBee/plugin-log-console'
import logBuffer from '@BBeBee/plugin-log-buffer'
import logFile from '@BBeBee/plugin-log-file'
import sources from '@BBeBee/plugin-sources'
import sourcesUi from '@BBeBee/plugin-sources-ui-desktop'
import sourceLocal from '@BBeBee/plugin-source-local'
import sourceRuntime from '@BBeBee/plugin-source-runtime'
import scanner from '@BBeBee/plugin-local-scanner'
import scannerUi from '@BBeBee/plugin-local-scanner-ui-desktop'
import player from '@BBeBee/plugin-player'
import playerUi from '@BBeBee/plugin-player-ui-desktop'


declare global {
  interface Window {
    BBeBee?: {
      paths: { get(kind: string): Promise<string | undefined> }
      shell: { openExternal(url: string): Promise<void> }
      dialog: { pickDirectory(): Promise<string | undefined> }
      platform: string
      versions: { electron: string; node: string }
    }
  }
}

/** Statically bundled plugins. On mobile this object is generated (docs/03 §6.1). */
export function registry(): PluginRegistry {
  const manifest = (id: string, capabilities: string[] = []) => ({
    id,
    version: '0.0.0',
    displayName: id,
    engines: { BBeBee: '^0.1.0' },
    entry: { main: './dist/index.js' },
    capabilities: capabilities as never,
  })

  const entry = (id: string, plugin: unknown, capabilities: string[] = []) => [
    id,
    { plugin: plugin as never, manifest: manifest(id, capabilities), builtin: true },
  ] as const

  return Object.fromEntries([
    entry('@BBeBee/plugin-ui', ui),
    entry('@BBeBee/plugin-log-console', logConsole),
    entry('@BBeBee/plugin-log-buffer', logBuffer),
    entry('@BBeBee/plugin-log-file', logFile, ['fs:read:logs', 'fs:write:logs']),
    entry('@BBeBee/plugin-inspector', inspector),
    entry('@BBeBee/plugin-inspector-ui-desktop', inspectorUi),
    entry('@BBeBee/plugin-hello', hello, ['db:own', 'secrets:own']),
    entry('@BBeBee/plugin-hello-ui-desktop', helloUi),

    // M1's feature set. Load order is derived from `inject`, never declared:
    // `plugin-player` waits for ctx.audio and ctx.sources, `plugin-source-*`
    // wait for ctx.sources, and none of them is sequenced here (docs/02 §3).
    entry('@BBeBee/plugin-sources', sources, ['db:read:core', 'db:write:core']),
    entry('@BBeBee/plugin-sources-ui-desktop', sourcesUi),
    entry('@BBeBee/plugin-local-scanner', scanner, [
      'fs:read:all',
      'db:read:core',
      'db:write:core',
    ]),
    entry('@BBeBee/plugin-local-scanner-ui-desktop', scannerUi),
    entry('@BBeBee/plugin-source-local', sourceLocal, [
      'fs:read:all',
      'db:read:core',
      'db:write:core',
    ]),
    entry('@BBeBee/plugin-source-runtime', sourceRuntime, ['net:host/*', 'db:read:core']),
    entry('@BBeBee/plugin-player', player, ['audio', 'db:read:core', 'db:write:core']),
    entry('@BBeBee/plugin-player-ui-desktop', playerUi),
  ])
}

const APP_VERSION = '0.0.0'

/** Electron's `process.platform`, as the protocol names it. */
function hostPlatform(): 'macos' | 'windows' | 'linux' {
  const raw = window.BBeBee?.platform ?? 'linux'
  return raw === 'darwin' ? 'macos' : raw === 'win32' ? 'windows' : 'linux'
}

export async function boot(): Promise<App> {
  // Paths are fetched once, up front: `PathsService` promises synchronous
  // access and IPC cannot provide it.
  const pathSnapshot = await fetchPaths()

  const app = createApp({
    target: 'desktop',
    bootstrap: [
      [PathsBridge, pathSnapshot],
      FsBridge,
      StoreFs,
      DbBridge,
      // The OS-facing trio. Each degrades to "no OS surface" rather than
      // throwing when the platform does not provide one, so a Linux box with
      // no MPRIS daemon still boots (docs/11 §4.3, §4.4).
      [DeviceElectron, { appVersion: APP_VERSION, platform: hostPlatform() }],
      BackgroundElectron,
      MediaSessionElectron,
      /*
       * The two M2 services an imported source needs.
       *
       * `SecretsNode` before `HttpNode`, because the jar store is built from
       * it: cookies are credential material and are envelope-encrypted under a
       * key that lives in the credential store (docs/04 §2.1).
       *
       * ⚠️ Both are *optional* to `plugin-source-runtime`. Without `js` a
       * document whose auth is scripted reports its search capability as
       * absent rather than offering a button that cannot work; without
       * `secrets` the cookie jars are in memory and honest about forgetting.
       * Neither absence stops a source that does not need it from playing.
       */
      SecretsNode,
      JsQuickJsNode,
    ],
    registry: registry(),
    config: {
      plugins: {
        '@BBeBee/plugin-ui': {},
        '@BBeBee/plugin-log-console': { config: { level: 3 } },
        '@BBeBee/plugin-log-buffer': {},
        '@BBeBee/plugin-log-file': {},
        '@BBeBee/plugin-inspector': {},
        '@BBeBee/plugin-inspector-ui-desktop': {},
        '@BBeBee/plugin-hello': { config: { greeting: 'Hello' } },
        '@BBeBee/plugin-hello-ui-desktop': {},

        // `ctx.http` — the source runtime injects it, so without this every
        // imported source sits PENDING and nothing remote plays. It adopts
        // `ctx.secrets` on its own for persistent cookie jars (docs/04 §2.1).
        '@BBeBee/core-http-node': {},

        '@BBeBee/plugin-sources': {},
        '@BBeBee/plugin-sources-ui-desktop': {},
        '@BBeBee/plugin-local-scanner': {},
        '@BBeBee/plugin-local-scanner-ui-desktop': {},
        '@BBeBee/plugin-source-local': {},
        '@BBeBee/plugin-source-runtime': {},
        // ⚠️ `plugin-player` injects `ctx.audio`, which no bootstrap entry
        // provides yet: `core-audio-webaudio` needs a real AudioContext, so
        // it lands with the audio spike's follow-up rather than here. Until
        // then the fiber sits PENDING — a diagnosable state the inspector
        // names, not a crash (docs/03 §2) — and the transport views render
        // against a service that is not there. Enabling it now would report
        // a plugin as healthy when it has never run.
        // '@BBeBee/plugin-player': {},
        // '@BBeBee/plugin-player-ui-desktop': {},
      },
    },
  })

  await app.start()
  return app
}
