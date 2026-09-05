/**
 * `ctx.secrets` on a file, against the shared contract.
 *
 * Beyond conformance: persistence across a restart, which is what "sign in
 * once, stay signed in" actually rests on (docs/10 §M2), and the honesty of
 * `isHardwareBacked` when there is no keychain to back it.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { secretsConformance } from '@BBeBee/protocol/conformance'
import { scopeContext } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'

async function harness(root?: string) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: root ?? (await tempDir('bbebee-secrets')) })
  await ctx.plugin(FsNode)
  await ctx.plugin(plugin, {})
  await tick()
  return ctx
}

describe(`${secretsConformance.service} conformance`, () => {
  for (const check of secretsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const ctx = await harness()
      await check.run({ secrets: ctx.secrets })
    })
  }
})

describe('persistence', () => {
  it('survives a restart', async () => {
    // The whole point: force-quit and relaunch, and the session is still there.
    const root = await tempDir('bbebee-secrets-restart')
    const first = await harness(root)
    await first.secrets.namespace('nav').set('token', 'abc123')

    const second = await harness(root)
    expect(await second.secrets.namespace('nav').get('token')).toBe('abc123')
  })

  it('does not leave the value readable on disk', async () => {
    // Obfuscation, not protection — but a token sitting in plaintext next to
    // the database would be found by the first person who looked.
    const root = await tempDir('bbebee-secrets-disk')
    const ctx = await harness(root)
    await ctx.secrets.set('token', 'hunter2secret')

    const dir = await ctx.fs.dir('data')
    const raw = await ctx.fs.readFile(ctx.fs.join(dir!, 'secrets.json'))
    expect(raw).not.toContain('hunter2secret')
  })

  it('forgets what was cleared, across a restart too', async () => {
    const root = await tempDir('bbebee-secrets-clear')
    const first = await harness(root)
    await first.secrets.namespace('nav').set('token', 'abc')
    await first.secrets.namespace('nav').clear()

    const second = await harness(root)
    expect(await second.secrets.namespace('nav').get('token')).toBeUndefined()
  })

  it('treats an undecryptable value as absent rather than failing for ever', async () => {
    /*
     * A restored backup on another machine, or a rotated keychain entry. "Sign
     * in again" is recoverable; an exception on every read of that namespace
     * is not.
     */
    const root = await tempDir('bbebee-secrets-corrupt')
    const ctx = await harness(root)
    await ctx.secrets.set('token', 'abc')
    const dir = await ctx.fs.dir('data')
    await ctx.fs.writeFile(ctx.fs.join(dir!, 'secrets.json'), '{"token":"!!!not-base64!!!"}')

    const reopened = await harness(root)
    expect(await reopened.secrets.get('token')).toBeUndefined()
  })
})

describe('honesty about what it is', () => {
  it('reports no hardware backing when there is no keychain', async () => {
    const ctx = await harness()
    expect(ctx.secrets.isHardwareBacked).toBe(false)
  })

  it('takes a platform codec when one is supplied', async () => {
    // The seam Electron's safeStorage plugs into.
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-secrets-codec') })
    await ctx.plugin(FsNode)
    await ctx.plugin(plugin, {
      crypto: {
        isHardwareBacked: true,
        encrypt: (plain: string) => `enc:${plain}`,
        decrypt: (cipher: string) => cipher.replace(/^enc:/, ''),
      },
    })
    await tick()

    expect(ctx.secrets.isHardwareBacked).toBe(true)
    await ctx.secrets.set('k', 'v')
    expect(await ctx.secrets.get('k')).toBe('v')
  })
})

describe('scoping', () => {
  it('confines a gated caller to its own namespace', async () => {
    /*
     * ⚠️ Without this `secrets:own` and `secrets:all` are the same grant: the
     * store read the intercept config for nothing, so any plugin holding
     * `ctx.secrets` could read — and overwrite — another plugin's credentials
     * just by naming their key.
     */
    const ctx = await harness()
    const a = scopeContext(ctx, { pluginId: '@BBeBee/a', requested: ['secrets:own'] as never })
    const b = scopeContext(ctx, { pluginId: '@BBeBee/b', requested: ['secrets:own'] as never })

    await a.secrets.set('token', 'a-token')
    await b.secrets.set('token', 'b-token')

    expect(await a.secrets.get('token')).toBe('a-token')
    expect(await b.secrets.get('token'), 'b cannot see a').toBe('b-token')
  })

  it('clearing one scope leaves another alone', async () => {
    const ctx = await harness()
    const a = scopeContext(ctx, { pluginId: '@BBeBee/a', requested: ['secrets:own'] as never })
    const b = scopeContext(ctx, { pluginId: '@BBeBee/b', requested: ['secrets:own'] as never })
    await a.secrets.set('token', 'a-token')
    await b.secrets.set('token', 'b-token')

    await a.secrets.clear()
    expect(await a.secrets.get('token')).toBeUndefined()
    expect(await b.secrets.get('token')).toBe('b-token')
  })

  it('leaves an ungated caller the whole store', async () => {
    // The kernel, a core service, a test. Without this `clear()` on the root
    // would clear nothing, and the store could never be reset.
    const ctx = await harness()
    const a = scopeContext(ctx, { pluginId: '@BBeBee/a', requested: ['secrets:own'] as never })
    await a.secrets.set('token', 'a-token')

    await ctx.secrets.clear()
    expect(await a.secrets.get('token')).toBeUndefined()
  })
})
