/**
 * M0's exit criteria, as tests.
 *
 * The first criterion — "the same plugin package loads and activates on iOS,
 * Android and Electron with no conditional code" — is checked here without a
 * GUI, by booting the real kernel with the desktop core services and asserting
 * the plugin activates and contributes. What a shell adds on top is rendering;
 * the claim under test is about the graph.
 */

import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { createApp, type PluginRegistry } from '@BBeBee/kernel'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import type { PluginManifest, RouteContribution } from '@BBeBee/protocol'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { StoreFs } from '@BBeBee/core-store-fs'
import { DbNode } from '@BBeBee/core-db-node'
import { Service } from 'cordis'
import ui from '@BBeBee/plugin-ui'
import inspector from '@BBeBee/plugin-inspector'
import logBuffer from '@BBeBee/plugin-log-buffer'
import logFile from '@BBeBee/plugin-log-file'
import hello, { HELLO_VIEW } from '../src/index.js'
import type { Hello } from '../src/index.js'

let root: string

beforeAll(async () => {
  root = await tempDir('bbebee-m0')
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Stands in for `core-device-*`, which arrives with M1. */
class FakeDevice extends Service {
  readonly platform = 'linux'
  readonly formFactor = 'desktop'
  readonly appVersion = '0.0.0'
  readonly locale = 'en'
  constructor(ctx: Context) {
    super(ctx, 'device')
  }
  async network() {
    return { online: true, type: 'ethernet' as const, metered: false }
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

function manifest(id: string, capabilities: string[] = []): PluginManifest {
  return {
    id,
    version: '0.0.0',
    displayName: id,
    engines: { BBeBee: '^0.1.0' },
    entry: { main: './dist/index.js' },
    capabilities: capabilities as never,
  }
}

function registry(): PluginRegistry {
  const entry = (id: string, plugin: unknown, caps: string[] = []) =>
    [id, { plugin: plugin as never, manifest: manifest(id, caps), builtin: true }] as const
  return Object.fromEntries([
    entry('@BBeBee/plugin-ui', ui),
    entry('@BBeBee/plugin-log-buffer', logBuffer),
    entry('@BBeBee/plugin-log-file', logFile, ['fs:read:logs', 'fs:write:logs']),
    entry('@BBeBee/plugin-inspector', inspector),
    entry('@BBeBee/plugin-hello', hello, ['db:own']),
  ])
}

async function bootApp(dir: string) {
  const app = createApp({
    target: 'desktop',
    bootstrap: [
      [PathsNode, { root: dir }],
      FsNode,
      [StoreFs, { flushDelayMs: 0 }],
      [DbNode, { fileName: 'm0.db' }],
      FakeDevice,
    ],
    registry: registry(),
    config: {
      plugins: {
        '@BBeBee/plugin-ui': {},
        '@BBeBee/plugin-log-buffer': {},
        '@BBeBee/plugin-log-file': {},
        '@BBeBee/plugin-inspector': {},
        '@BBeBee/plugin-hello': { config: { greeting: 'Hei' } },
      },
    },
  })
  await app.start()
  await tick()
  return app
}

describe('M0: the kernel boots and a plugin contributes', () => {
  it('every configured plugin reaches ACTIVE', async () => {
    const app = await bootApp(await mkdtemp(join(root, 'boot-')))
    const byState = app.plugins.map((p) => `${p.pluginId}=${p.state}`)
    expect(byState.every((s) => s.endsWith('=active')), byState.join(' ')).toBe(true)
    await app.stop()
  })

  it('the shell can resolve a contributed route through ctx.ui', async () => {
    const app = await bootApp(await mkdtemp(join(root, 'route-')))
    const ctx = await app.ready(['ui'], { timeoutMs: 5000 })

    const routes = ctx.ui.routes as readonly RouteContribution[]
    const route = routes.find((r) => r.id === HELLO_VIEW)
    expect(route, 'plugin-hello did not contribute its route').toBeDefined()
    expect(route!.title).toBe('Hello')

    // No UI package is loaded here, so no view is bound — and that is a
    // normal state a shell must handle, not a crash (docs/08 §3).
    expect(ctx.ui.viewFor(HELLO_VIEW)).toBeUndefined()
    expect(ctx.ui.missingViews()).toContain(HELLO_VIEW)
    await app.stop()
  })

  it('the plugin used db, store and logging without naming a platform', async () => {
    const dir = await mkdtemp(join(root, 'services-'))
    const app = await bootApp(dir)
    const state = (app.ctx.hello as Hello).snapshot

    expect(state.greeting).toBe('Hei')
    expect(state.launchCount).toBe(1)
    expect(state.noteCount).toBe(1)
    // The platform reaches the plugin as data from `ctx.device`, never as a
    // branch — which is what "no conditional code" means concretely.
    expect(state.platformNote).toBe('linux · desktop')
    await app.stop()
  })

  it('state persists across a restart, proving the services are real', async () => {
    const dir = await mkdtemp(join(root, 'restart-'))
    const first = await bootApp(dir)
    expect((first.ctx.hello as Hello).snapshot.launchCount).toBe(1)
    await first.stop()

    const second = await bootApp(dir)
    const state = (second.ctx.hello as Hello).snapshot
    expect(state.launchCount, 'store did not persist').toBe(2)
    expect(state.noteCount, 'db did not persist').toBe(2)
    await second.stop()
  })

  it('a contributed command runs and updates state', async () => {
    const app = await bootApp(await mkdtemp(join(root, 'command-')))
    const ctx = await app.ready(['ui'], { timeoutMs: 5000 })

    const before = (app.ctx.hello as Hello).snapshot.noteCount
    await ctx.ui.runCommand('hello.addNote')
    expect((app.ctx.hello as Hello).snapshot.noteCount).toBe(before + 1)
    await app.stop()
  })

  it('the log file transport actually wrote', async () => {
    const dir = await mkdtemp(join(root, 'logs-'))
    const app = await bootApp(dir)
    await new Promise((r) => setTimeout(r, 1200))
    await app.stop()

    const content = await readFile(join(dir, 'logs', 'app.log'), 'utf8')
    expect(content).toContain('hello: launch 1')
  })
})

describe('M0: the plugin inspector shows the fiber tree', () => {
  it('reports every plugin with its state, provides and labelled effects', async () => {
    const app = await bootApp(await mkdtemp(join(root, 'inspect-')))
    const snap = app.ctx.inspector.snapshot()

    const names: string[] = []
    const walk = (node: { name: string; children: { name: string }[] }) => {
      names.push(node.name)
      for (const child of node.children as never[]) walk(child)
    }
    walk(snap.root as never)

    expect(names).toContain('plugin-hello')
    expect(snap.counts.ACTIVE).toBeGreaterThan(0)
    // Nothing should be stuck: a stalled fiber is the thing the inspector
    // exists to make visible.
    expect(snap.stalled, JSON.stringify(snap.stalled)).toEqual([])

    // Labelled effects are the point — they are how a leak is found.
    const rendered = app.ctx.inspector.render()
    expect(rendered).toContain('hello-contributions')
    expect(rendered).toContain('provides:')
    await app.stop()
  })

  it('shows a stalled plugin and names what it waits for', async () => {
    const ctx = new Context()
    await ctx.plugin(inspector)
    ctx.plugin({ name: 'needs-nothing-real', inject: ['absentService'], apply: () => {} })
    await tick()

    const snap = ctx.inspector.snapshot()
    const stalled = snap.stalled.find((s) => s.waitingFor.includes('absentService'))
    expect(stalled, JSON.stringify(snap.stalled)).toBeDefined()
    expect(stalled!.state).toBe('PENDING')
  })
})

describe('M0: disabling a plugin restores the context exactly', () => {
  it('loading and unloading plugin-hello leaves no trace', async () => {
    const dir = await mkdtemp(join(root, 'leak-'))
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: dir })
    await ctx.plugin(FsNode)
    await ctx.plugin(StoreFs, { flushDelayMs: 0 })
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(FakeDevice)
    await ctx.plugin(ui)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(hello, {})
    await tick()
    expect(ctx.ui.routes.some((r) => r.id === HELLO_VIEW)).toBe(true)

    await fiber.dispose()
    await tick()

    // The contribution is gone with the plugin — no invalidation protocol.
    expect(ctx.ui.routes.some((r) => r.id === HELLO_VIEW)).toBe(false)
    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
