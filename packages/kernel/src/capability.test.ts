import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { CapabilityError, type Capability } from '@BBeBee/protocol'
import {
  assertFs,
  assertGranted,
  assertHost,
  capabilityConfigOf,
  scopeContext,
} from './capability.js'
import { tick } from './testing.js'

describe('scopeContext', () => {
  it('delivers grants to every mediated service', async () => {
    // The gate works by interception: the kernel injects the grant set, and
    // each core service reads it off its resolved config.
    const ctx = new Context()
    let seen: unknown

    class FakeFs extends Service<{ granted?: string[] }> {
      constructor(c: Context) {
        super(c, 'fs')
      }
      read(this: FakeFs) {
        seen = this[Service.resolveConfig]()
      }
    }
    await ctx.plugin(FakeFs)

    const scoped = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-demo',
      requested: ['fs:read:media'] as Capability[],
    })
    ;(scoped as never as { fs: FakeFs }).fs.read()
    await tick()

    expect(seen).toMatchObject({
      pluginId: '@BBeBee/plugin-demo',
      granted: ['fs:read:media'],
    })
  })

  it('prefers explicit grants over the manifest request', () => {
    // A runtime-installed plugin gets what the user approved, not what it asked
    // for. Requesting more than was granted must not widen access.
    const ctx = new Context()
    const scoped = scopeContext(ctx, {
      pluginId: 'p',
      requested: ['fs:read:all', 'net:host/*'] as Capability[],
      granted: ['fs:read:cache'],
    })
    const config = (scoped as never as Record<symbol, Record<string, unknown>>)[
      Context.intercept as unknown as symbol
    ]
    expect(config!['fs']).toMatchObject({ granted: ['fs:read:cache'] })
  })
})

describe('capabilityConfigOf', () => {
  it('returns undefined for an unmediated caller', () => {
    // The kernel, a core service calling another, and test harnesses are all
    // trusted — they simply have no gate config.
    expect(capabilityConfigOf(undefined)).toBeUndefined()
    expect(capabilityConfigOf({})).toBeUndefined()
    expect(capabilityConfigOf({ pluginId: 'p' })).toBeUndefined()
  })

  it('reads a well-formed config', () => {
    expect(capabilityConfigOf({ pluginId: 'p', granted: ['audio'] })).toEqual({
      pluginId: 'p',
      // Defaults to pluginId when no instance was configured.
      instanceId: 'p',
      granted: ['audio'],
    })
  })
})

describe('assertions', () => {
  const gate = (granted: string[]) => ({ pluginId: 'p', granted })

  it('allows an in-scope fs read and refuses one out of scope', () => {
    expect(() => assertFs(gate(['fs:read:media']), 'read', 'media')).not.toThrow()
    expect(() => assertFs(gate(['fs:read:media']), 'read', 'downloads')).toThrow(CapabilityError)
  })

  it('never refuses an ungated caller', () => {
    expect(() => assertFs(undefined, 'write', 'all')).not.toThrow()
  })

  it('allows a granted host and refuses others', () => {
    const g = gate(['net:host/*.example.org'])
    expect(() => assertHost(g, 'https://music.example.org/rest/ping')).not.toThrow()
    expect(() => assertHost(g, 'https://evil.com/collect')).toThrow(CapabilityError)
  })

  it('refuses a malformed url rather than letting it through', () => {
    expect(() => assertHost(gate(['net:host/*']), 'not a url')).toThrow(CapabilityError)
  })

  it('checks flag capabilities by name', () => {
    expect(() => assertGranted(gate(['audio']), 'audio')).not.toThrow()
    expect(() => assertGranted(gate(['audio']), 'notify')).toThrow(CapabilityError)
  })

  it('reports the capability that was missing', () => {
    try {
      assertHost(gate([]), 'https://music.example.org')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityError)
      expect((e as CapabilityError).capability).toBe('net:host/music.example.org')
      expect((e as CapabilityError).message).toContain('p')
    }
  })
})
