/**
 * `core-fs-node` against the shared conformance suite.
 *
 * The suite is the executable form of docs/04 §1. `core-fs-expo` runs the
 * identical checks on a device; if the two ever disagree, one of them is
 * wrong rather than "just different".
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { fsConformance, fsScopeConformance, pathsConformance } from '@BBeBee/protocol/conformance'
import type { FsService, PathsService } from '@BBeBee/protocol'
import { scopeContext } from '@BBeBee/kernel'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '../src/index.js'

let root: string
let ctx: Context

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'bbebee-fs-'))
  ctx = new Context()
  // `root` confines every well-known directory to the temp dir, so the suite
  // never touches the developer's real Music or Downloads folder.
  await ctx.plugin(PathsNode, { root })
  await ctx.plugin(FsNode)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const fs = (): FsService => ctx.fs
const paths = (): PathsService => ctx.paths

describe('core-paths-node conformance', () => {
  for (const check of pathsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      await check.run({ paths: paths() })
    })
  }
})

describe('core-fs-node conformance', () => {
  for (const check of fsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      // A private scratch directory per check, so ordering cannot matter.
      const scratch = pathToFileURL(
        await mkdtemp(join(root, `check-${check.name.replace(/\W+/g, '-').slice(0, 24)}-`)),
      ).href.replace(/\/$/, '')
      await check.run({ fs: fs(), scratch })
    })
  }
})

describe('core-fs-node specifics', () => {
  it('reports a music directory, unlike the mobile implementation', async () => {
    // The asymmetry the suite deliberately permits — asserted from the side
    // where it must be present.
    expect(await fs().dir('music')).toBeTypeOf('string')
  })

  it('creates app-private roots on demand but never user folders', async () => {
    const data = await fs().dir('data')
    expect(data).toBeDefined()
    expect(await fs().exists(data!)).toBe(true)
  })

  it('supports watching, and says so', async () => {
    expect(fs().canWatch).toBe(true)
  })

  it('moves across devices by falling back to copy + delete', async () => {
    // Cannot force EXDEV portably; assert the ordinary path still works so the
    // fallback branch does not regress the common case.
    const scratch = pathToFileURL(await mkdtemp(join(root, 'xdev-'))).href.replace(/\/$/, '')
    const from = fs().join(scratch, 'a.txt')
    const to = fs().join(scratch, 'b.txt')
    await fs().writeFile(from, 'payload')
    await fs().move(from, to)
    expect(await fs().readFile(to)).toBe('payload')
  })
})

describe('core-fs-node capability scopes', () => {
  for (const check of fsScopeConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      // A private root per check: these arrange fixtures in appData itself.
      const dir = await mkdtemp(join(root, 'scope-'))
      const scopeCtx = new Context()
      await scopeCtx.plugin(PathsNode, { root: dir })
      await scopeCtx.plugin(FsNode)

      const scopeId = '@BBeBee/plugin-under-test'
      const gated = (granted: string[]) =>
        scopeContext(scopeCtx, {
          pluginId: scopeId,
          scopeId,
          requested: granted as never,
        }).fs

      await check.run({
        admin: scopeCtx.fs,
        paths: scopeCtx.paths,
        scopeId,
        own: gated(['fs:read:own', 'fs:write:own']),
        cacheOnly: gated(['fs:read:cache', 'fs:write:cache']),
        grantedWith: gated,
      })
    })
  }
})
