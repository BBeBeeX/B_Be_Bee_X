/**
 * The mobile bootstrap.
 *
 * Compare with `apps/desktop/renderer/boot.ts`: the plugin list and the config
 * are the same, and only the core-service registrations differ. That is ADR-3
 * and the layer model working (docs/02 §3).
 */

import { Platform } from 'react-native'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import { createApp, type App, type PluginRegistry } from '@BBeBee/kernel'
import type { DeviceService, NetworkState, Platform as BPlatform } from '@BBeBee/protocol'
import { PathsExpo } from '@BBeBee/core-paths-expo'
import { FsExpo } from '@BBeBee/core-fs-expo'
import { StoreFs } from '@BBeBee/core-store-fs'
import { DbExpo } from '@BBeBee/core-db-expo'

import ui from '@BBeBee/plugin-ui'
import inspector from '@BBeBee/plugin-inspector'
import hello from '@BBeBee/plugin-hello'
import logConsole from '@BBeBee/plugin-log-console'
import logBuffer from '@BBeBee/plugin-log-buffer'
import logFile from '@BBeBee/plugin-log-file'
import { createPlugin as createHelloUi } from '@BBeBee/plugin-hello-ui-mobile'
import { View, Text, Pressable } from 'react-native'

/** Minimal `ctx.device`; the full `core-device-expo` lands with M1. */
class DeviceExpo extends Service implements DeviceService {
  readonly platform: BPlatform = Platform.OS === 'ios' ? 'ios' : 'android'
  readonly formFactor = 'phone' as const
  readonly appVersion = '0.0.0'
  readonly locale = 'en'

  constructor(ctx: Context) {
    super(ctx, 'device')
  }

  async network(): Promise<NetworkState> {
    return { online: true, type: 'unknown', metered: false }
  }
  onNetworkChange() {
    return () => {}
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

function registry(): PluginRegistry {
  const manifest = (id: string, capabilities: string[] = []) => ({
    id,
    version: '0.0.0',
    displayName: id,
    engines: { BBeBee: '^0.1.0' },
    entry: { main: './dist/index.js' },
    capabilities: capabilities as never,
  })
  const entry = (id: string, plugin: unknown, capabilities: string[] = []) =>
    [id, { plugin: plugin as never, manifest: manifest(id, capabilities), builtin: true }] as const

  return Object.fromEntries([
    entry('@BBeBee/plugin-ui', ui),
    entry('@BBeBee/plugin-log-console', logConsole),
    entry('@BBeBee/plugin-log-buffer', logBuffer),
    entry('@BBeBee/plugin-log-file', logFile, ['fs:read:logs', 'fs:write:logs']),
    entry('@BBeBee/plugin-inspector', inspector),
    entry('@BBeBee/plugin-hello', hello, ['db:own', 'secrets:own']),
    // The mobile view package takes its primitives as an argument, so nothing
    // outside the shell imports `react-native`.
    entry('@BBeBee/plugin-hello-ui-mobile', createHelloUi({ View, Text, Pressable })),
  ])
}

export async function boot(): Promise<App> {
  const app = createApp({
    target: Platform.OS === 'ios' ? 'ios' : 'android',
    bootstrap: [
      PathsExpo,
      FsExpo,
      StoreFs,
      DbExpo,
      DeviceExpo,
    ],
    registry: registry(),
    config: {
      plugins: {
        '@BBeBee/plugin-ui': {},
        '@BBeBee/plugin-log-console': { config: { level: 3 } },
        '@BBeBee/plugin-log-buffer': {},
        '@BBeBee/plugin-log-file': {},
        '@BBeBee/plugin-inspector': {},
        '@BBeBee/plugin-hello': { config: { greeting: 'Hello' } },
        '@BBeBee/plugin-hello-ui-mobile': {},
      },
    },
  })
  await app.start()
  return app
}
