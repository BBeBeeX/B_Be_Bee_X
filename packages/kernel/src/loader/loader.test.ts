import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { PluginManifest } from '@BBeBee/protocol'
import { createApp } from '../bootstrap/app.js'
import { loadPlugin, loadPlugins, type PluginRegistry } from './loader.js'

function manifest(id: string, over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    version: '1.0.0',
    displayName: id,
    engines: { BBeBee: '^1.0.0' },
    entry: { main: './index.js' },
    capabilities: [],
    ...over,
  }
}

describe('loader dynamic loading', () => {
  it('loads a plugin dynamically using load returning default export', async () => {
    const ctx = new Context()
    const applied = vi.fn()
    const registry: PluginRegistry = {
      dynamic: {
        load: async () => ({ default: { name: 'dynamic', apply: applied } }),
        manifest: manifest('dynamic'),
        builtin: true,
      },
    }

    const results = await loadPlugins(ctx, registry, [
      { pluginId: 'dynamic', config: { opt: 1 } },
    ])

    expect(results).toHaveLength(1)
    expect(results[0]?.state).toBe('active')
    expect(applied).toHaveBeenCalledTimes(1)
    // entry.plugin is cached
    expect(registry['dynamic']?.plugin).toBeDefined()
  })

  it('loads a plugin dynamically using load returning plugin object directly', async () => {
    const ctx = new Context()
    const applied = vi.fn()
    const registry: PluginRegistry = {
      direct: {
        load: async () => ({ name: 'direct', apply: applied }),
        manifest: manifest('direct'),
        builtin: true,
      },
    }

    const results = await loadPlugins(ctx, registry, [
      { pluginId: 'direct', config: {} },
    ])

    expect(results[0]?.state).toBe('active')
    expect(applied).toHaveBeenCalledTimes(1)
  })

  it('handles dynamic load failure gracefully and emits plugin/failed', async () => {
    const ctx = new Context()
    const failedEvent = vi.fn()
    ctx.on('plugin/failed', failedEvent)

    const registry: PluginRegistry = {
      broken: {
        load: async () => {
          throw new Error('chunk fetch error')
        },
        manifest: manifest('broken'),
        builtin: true,
      },
    }

    const results = await loadPlugins(ctx, registry, [
      { pluginId: 'broken', config: {} },
    ])

    expect(results[0]?.state).toBe('failed')
    expect(results[0]?.error?.message).toMatch(/chunk fetch error/)
    expect(failedEvent).toHaveBeenCalledWith('broken', expect.any(Error))
  })

  it('reports failure when entry has neither plugin nor load function', async () => {
    const ctx = new Context()
    const registry: PluginRegistry = {
      empty: {
        manifest: manifest('empty'),
        builtin: true,
      },
    }

    const results = await loadPlugins(ctx, registry, [
      { pluginId: 'empty', config: {} },
    ])

    expect(results[0]?.state).toBe('failed')
    expect(results[0]?.error?.message).toMatch(
      /provides neither a plugin instance nor a load function/,
    )
  })

  it('supports single plugin loading with loadPlugin', async () => {
    const ctx = new Context()
    const applied = vi.fn()
    const registry: PluginRegistry = {
      single: {
        load: async () => ({ default: applied }),
        manifest: manifest('single'),
        builtin: true,
      },
    }

    const loaded = await loadPlugin(ctx, registry, {
      pluginId: 'single',
      config: {},
    })

    expect(loaded.state).toBe('active')
    expect(applied).toHaveBeenCalledTimes(1)
  })

  it('allows dynamic loading and unloading via app.loadPlugin and app.unloadPlugin', async () => {
    const applied = vi.fn()
    const disposed = vi.fn()

    const registry: PluginRegistry = {
      runtime: {
        load: async () => ({
          default: {
            name: 'runtime',
            apply: async () => {
              applied()
              return () => {
                disposed()
              }
            },
          },
        }),
        manifest: manifest('runtime'),
        builtin: true,
      },
    }

    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry,
      config: { plugins: {} },
    })

    await app.start()
    expect(app.plugins).toHaveLength(0)

    // Dynamically load
    const loaded = await app.loadPlugin('runtime')
    expect(loaded.state).toBe('active')
    expect(applied).toHaveBeenCalledTimes(1)
    expect(app.plugins.find((p) => p.pluginId === 'runtime')?.state).toBe('active')

    // Calling loadPlugin on an already active plugin returns existing
    const reload = await app.loadPlugin('runtime')
    expect(reload).toBe(loaded)
    expect(applied).toHaveBeenCalledTimes(1)

    // Dynamically unload
    await app.unloadPlugin('runtime')
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(app.plugins.find((p) => p.pluginId === 'runtime')).toBeUndefined()

    await app.stop()
  })
})
