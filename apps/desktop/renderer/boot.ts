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

import ui from '@BBeBee/plugin-ui'
import inspector from '@BBeBee/plugin-inspector'
import inspectorUi from '@BBeBee/plugin-inspector-ui-desktop'
import hello from '@BBeBee/plugin-hello'
import helloUi from '@BBeBee/plugin-hello-ui-desktop'
import logConsole from '@BBeBee/plugin-log-console'
import logBuffer from '@BBeBee/plugin-log-buffer'
import logFile from '@BBeBee/plugin-log-file'

import type { Context } from 'cordis'
import type { DeviceService, NetworkState, Platform } from '@BBeBee/protocol'
import { Service } from 'cordis'

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

/**
 * A minimal `ctx.device` for the desktop shell.
 *
 * The real `core-device-electron` arrives with M1's media keys and network
 * awareness; `plugin-hello` only needs `platform` and `formFactor`, and a
 * stub that says so is better than pulling an unbuilt package forward.
 */
class DeviceDesktop extends Service implements DeviceService {
  readonly platform: Platform
  readonly formFactor = 'desktop' as const
  readonly appVersion = '0.0.0'
  readonly locale: string

  constructor(ctx: Context) {
    super(ctx, 'device')
    const raw = window.BBeBee?.platform ?? 'linux'
    this.platform = raw === 'darwin' ? 'macos' : raw === 'win32' ? 'windows' : 'linux'
    this.locale = navigator.language ?? 'en'
  }

  async network(): Promise<NetworkState> {
    return { online: navigator.onLine, type: 'unknown', metered: false }
  }
  onNetworkChange(cb: (s: NetworkState) => void) {
    const handler = () => void this.network().then(cb)
    window.addEventListener('online', handler)
    window.addEventListener('offline', handler)
    return () => {
      window.removeEventListener('online', handler)
      window.removeEventListener('offline', handler)
    }
  }
  async battery() {
    return undefined
  }
  onMediaKey() {
    return () => {}
  }
  registerHotkey() {
    return () => {}
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
  ])
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
      DeviceDesktop,
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
      },
    },
  })

  await app.start()
  return app
}
