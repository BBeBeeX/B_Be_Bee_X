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

import ui from '@BBeBee/plugin-ui'
import inspector from '@BBeBee/plugin-inspector'
import inspectorUi from '@BBeBee/plugin-inspector-ui-desktop'
import hello from '@BBeBee/plugin-hello'
import helloUi from '@BBeBee/plugin-hello-ui-desktop'
import logConsole from '@BBeBee/plugin-log-console'
import logBuffer from '@BBeBee/plugin-log-buffer'
import logFile from '@BBeBee/plugin-log-file'


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
