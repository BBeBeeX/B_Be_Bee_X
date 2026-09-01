import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { CapabilityError, type Capability } from '@BBeBee/protocol'
import {
  assertDb,
  assertFs,
  assertGranted,
  assertHost,
  capabilityConfigOf,
  classifyDbAccess,
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

describe('classifyDbAccess', () => {
  it('classifies the ordinary statements', () => {
    expect(classifyDbAccess('SELECT * FROM tracks')).toBe('read')
    expect(classifyDbAccess('  select 1')).toBe('read')
    expect(classifyDbAccess('INSERT INTO tracks (urn) VALUES (?)')).toBe('write')
    expect(classifyDbAccess("UPDATE tracks SET title = 'x'")).toBe('write')
    expect(classifyDbAccess('DELETE FROM tracks')).toBe('write')
    expect(classifyDbAccess('DROP TABLE tracks')).toBe('schema')
    expect(classifyDbAccess('CREATE INDEX idx ON tracks(urn)')).toBe('schema')
  })

  it('looks past a CTE to what the statement actually does', () => {
    expect(classifyDbAccess('WITH t AS (SELECT 1) SELECT * FROM t')).toBe('read')
    expect(classifyDbAccess('WITH t AS (SELECT 1) DELETE FROM tracks WHERE urn IN t')).toBe('write')
  })

  it('takes the most demanding statement in a multi-statement string', () => {
    // Otherwise a DROP rides in behind a SELECT on a read grant.
    expect(classifyDbAccess('SELECT 1; DROP TABLE tracks')).toBe('schema')
    expect(classifyDbAccess('SELECT 1; UPDATE tracks SET title = ?')).toBe('write')
  })

  it('fails closed on comments and on anything it cannot read', () => {
    expect(classifyDbAccess('-- SELECT 1\nDROP TABLE tracks')).toBe('schema')
    expect(classifyDbAccess('/* hi */ SELECT 1')).toBe('read')
    expect(classifyDbAccess('kaboom FROM tracks')).toBe('schema')
  })
})

describe('assertDb verbs', () => {
  const gate = (granted: string[]) => ({ pluginId: 'p', instanceId: 'p', granted })
  const own = 'plugin_p'

  it('db:read:core permits SELECT and refuses mutation', () => {
    const g = gate(['db:own', 'db:read:core'])
    expect(() => assertDb(g, 'SELECT * FROM tracks', own)).not.toThrow()
    expect(() => assertDb(g, "UPDATE tracks SET title='x'", own)).toThrow(CapabilityError)
    expect(() => assertDb(g, 'DELETE FROM tracks', own)).toThrow(CapabilityError)
  })

  it('db:write:core permits mutation and refuses reads and schema changes', () => {
    const g = gate(['db:own', 'db:write:core'])
    expect(() => assertDb(g, 'INSERT INTO tracks (urn) VALUES (?)', own)).not.toThrow()
    expect(() => assertDb(g, 'SELECT * FROM tracks', own)).toThrow(CapabilityError)
    expect(() => assertDb(g, 'DROP TABLE tracks', own)).toThrow(CapabilityError)
  })

  it('db:*:core permits everything in that namespace', () => {
    const g = gate(['db:own', 'db:*:core'])
    expect(() => assertDb(g, 'SELECT * FROM tracks', own)).not.toThrow()
    expect(() => assertDb(g, 'INSERT INTO tracks (urn) VALUES (?)', own)).not.toThrow()
    expect(() => assertDb(g, 'DROP TABLE tracks', own)).not.toThrow()
  })

  it('leaves a plugin its own tables outright', () => {
    const g = gate(['db:own'])
    expect(() => assertDb(g, 'DROP TABLE plugin_p_items', own)).not.toThrow()
    expect(() => assertDb(g, 'SELECT * FROM tracks', own)).toThrow(/outside its own namespace/)
  })

  it('names the grant a refused statement would have needed', () => {
    try {
      assertDb(gate(['db:own', 'db:read:core']), 'INSERT INTO tracks (urn) VALUES (?)', own)
      expect.unreachable()
    } catch (e) {
      expect((e as CapabilityError).capability).toBe('db:write:core')
      expect((e as CapabilityError).message).toContain('tracks')
    }
    try {
      assertDb(gate(['db:own', 'db:write:core']), 'DROP TABLE tracks', own)
      expect.unreachable()
    } catch (e) {
      expect((e as CapabilityError).capability).toBe('db:*:core')
    }
  })

  it('still refuses a namespace with no grant at all', () => {
    const g = gate(['db:own', 'db:*:core'])
    expect(() => assertDb(g, 'SELECT * FROM plugin_other_notes', own)).toThrow(
      /outside its own namespace/,
    )
  })
})
