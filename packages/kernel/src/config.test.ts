import { describe, expect, it } from 'vitest'
import { ConfigError } from '@BBeBee/protocol'
import { isEnabled, resolveConfig } from './config.js'

describe('resolveConfig', () => {
  it('resolves a plain plugin to one instance keyed by its own id', () => {
    expect(
      resolveConfig({ plugins: { '@BBeBee/plugin-player': { config: { crossfadeMs: 0 } } } }),
    ).toEqual([
      {
        pluginId: '@BBeBee/plugin-player',
        instanceId: '@BBeBee/plugin-player',
        config: { crossfadeMs: 0 },
      },
    ])
  })

  it('skips disabled plugins', () => {
    expect(resolveConfig({ plugins: { a: { enabled: false } } })).toEqual([])
  })

  it('expands instances, one activation each', () => {
    const resolved = resolveConfig({
      plugins: {
        '@BBeBee/plugin-source-subsonic': {
          instances: [
            { id: 'navidrome-home', config: { baseUrl: 'https://home' } },
            { id: 'navidrome-work', config: { baseUrl: 'https://work' } },
          ],
        },
      },
    })
    expect(resolved).toHaveLength(2)
    expect(resolved.map((r) => r.instanceId)).toEqual(['navidrome-home', 'navidrome-work'])
    expect(resolved[0]!.config).toEqual({ baseUrl: 'https://home' })
  })

  it('overlays instance config onto plugin-level defaults', () => {
    const [only] = resolveConfig({
      plugins: {
        p: {
          config: { quality: 'high', timeout: 30 },
          instances: [{ id: 'one', config: { quality: 'lossless' } }],
        },
      },
    })
    expect(only!.config).toEqual({ quality: 'lossless', timeout: 30 })
  })

  it('rejects a duplicate instance id across different plugins', () => {
    // Two providers sharing an id would produce colliding URNs.
    expect(() =>
      resolveConfig({
        plugins: {
          a: { instances: [{ id: 'shared' }] },
          b: { instances: [{ id: 'shared' }] },
        },
      }),
    ).toThrow(ConfigError)
  })

  it('rejects an instance id containing the urn separator', () => {
    expect(() => resolveConfig({ plugins: { a: { instances: [{ id: 'a:b' }] } } })).toThrow(
      ConfigError,
    )
  })

  it('rejects an empty instance id', () => {
    expect(() => resolveConfig({ plugins: { a: { instances: [{ id: '' }] } } })).toThrow(
      ConfigError,
    )
  })

  it('handles an empty document', () => {
    expect(resolveConfig({})).toEqual([])
  })
})

describe('isEnabled', () => {
  it('is false for an unmentioned plugin', () => {
    // Configuration is the allowlist: presence in the registry is not enough.
    expect(isEnabled({ plugins: {} }, 'a')).toBe(false)
  })

  it('defaults to true when mentioned without an explicit flag', () => {
    expect(isEnabled({ plugins: { a: {} } }, 'a')).toBe(true)
  })

  it('honours an explicit false', () => {
    expect(isEnabled({ plugins: { a: { enabled: false } } }, 'a')).toBe(false)
  })
})
