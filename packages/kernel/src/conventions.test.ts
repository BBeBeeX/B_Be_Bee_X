/**
 * Architectural conventions, checked over the real workspace.
 *
 * These exist because the same defect shape bit twice while building M0: a
 * wrapper that spawns a child plugin without awaiting it. `app.start()` now
 * settles the graph so the mistake is no longer *harmful*, but it still makes
 * a plugin's readiness unreportable to anyone loading it directly — so it is
 * worth catching at the source.
 *
 * A scan rather than a lint rule on purpose: the detector itself is tested
 * below, which a hand-written esquery selector would not be.
 */

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * Find `ctx.plugin(...)` calls whose result is neither awaited nor returned.
 *
 * Deliberately textual and conservative: it looks only for the two shapes that
 * actually occurred (`const x = ctx.plugin(`, and a bare or `void`-ed call),
 * and treats anything with `await` in front as fine. A parser would be more
 * precise, but this is checkable — see the self-test.
 */
export function findUnawaitedPlugin(source: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = []
  source.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line.startsWith('//') || line.startsWith('*')) return
    if (!/\bctx\.plugin\(|\bthis\.ctx\.plugin\(/.test(line)) return
    // `await ctx.plugin(`, `return ctx.plugin(` and `=> ctx.plugin(` all
    // propagate readiness to the caller.
    if (/\bawait\s+(this\.)?ctx\.plugin\(/.test(line)) return
    if (/\breturn\s+(this\.)?ctx\.plugin\(/.test(line)) return
    if (/=>\s*(this\.)?ctx\.plugin\(/.test(line)) return
    hits.push({ line: index + 1, text: line })
  })
  return hits
}

/**
 * Find a plugin entry point declared as a plain (non-async) `function`.
 *
 * Cordis decides "is this a class?" with `!!func.prototype`, and a classic
 * function declaration has one — so `export function apply(ctx) { … }` is
 * `new`-ed as if it were a service, and **the disposer it returns is thrown
 * away**. The plugin loads and works; it just never unloads, which is the one
 * thing this architecture claims is impossible (docs/03 §2).
 *
 * `async function`, arrow functions and object-method shorthand all have no
 * prototype and are safe. So is a class, which is meant to be constructed.
 */
export function findSyncFunctionApply(source: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = []
  source.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line.startsWith('//') || line.startsWith('*')) return
    if (/^(export\s+)?function\s+apply\s*\(/.test(line)) {
      hits.push({ line: index + 1, text: line })
    }
  })
  return hits
}

async function sourceFiles(): Promise<string[]> {
  const packagesDir = join(workspaceRoot, 'packages')
  const out: string[] = []

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        await walk(full)
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
        out.push(full)
      }
    }
  }

  for (const pkg of await readdir(packagesDir)) {
    if (!/^(plugin|core)-/.test(pkg)) continue
    await walk(join(packagesDir, pkg, 'src')).catch(() => undefined)
  }
  return out
}

describe('the detector itself', () => {
  it('flags the shapes that actually occurred', () => {
    expect(findUnawaitedPlugin('  const fiber = ctx.plugin(Svc)')).toHaveLength(1)
    expect(findUnawaitedPlugin('  void ctx.plugin(Svc)')).toHaveLength(1)
    expect(findUnawaitedPlugin('  ctx.plugin(Svc, config)')).toHaveLength(1)
    expect(findUnawaitedPlugin('  const f = this.ctx.plugin(Svc)')).toHaveLength(1)
  })

  it('accepts the forms that propagate readiness', () => {
    expect(findUnawaitedPlugin('  const fiber = await ctx.plugin(Svc)')).toEqual([])
    expect(findUnawaitedPlugin('  return ctx.plugin(Svc)')).toEqual([])
    expect(findUnawaitedPlugin('  await this.ctx.plugin(Svc)')).toEqual([])
  })

  it('ignores comments, so prose about the rule does not trip it', () => {
    expect(findUnawaitedPlugin('  // never write ctx.plugin(Svc) without await')).toEqual([])
  })
})

describe('the apply-shape detector', () => {
  it('flags the shape whose disposer is silently dropped', () => {
    expect(findSyncFunctionApply('export function apply(ctx: Context) {')).toHaveLength(1)
    expect(findSyncFunctionApply('function apply(ctx) {')).toHaveLength(1)
  })

  it('accepts the shapes cordis treats as functions', () => {
    expect(findSyncFunctionApply('export async function apply(ctx: Context) {')).toEqual([])
    expect(findSyncFunctionApply('export const apply = (ctx: Context) => {')).toEqual([])
    expect(findSyncFunctionApply('  apply(ctx: Context) {')).toEqual([])
  })
})

describe('workspace conventions', () => {
  it('no plugin entry point is a plain function declaration', async () => {
    // Cordis `new`s anything with a prototype, and drops what it returns.
    const offenders: string[] = []
    for (const file of await sourceFiles()) {
      const source = await readFile(file, 'utf8')
      for (const hit of findSyncFunctionApply(source)) {
        offenders.push(`${relative(workspaceRoot, file)}:${hit.line}  ${hit.text}`)
      }
    }
    expect(
      offenders,
      'a plain `function apply` is constructed by cordis and its disposer is discarded; ' +
        `use \`async function\` or an arrow:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('no plugin spawns a child without awaiting it', async () => {
    const offenders: string[] = []
    for (const file of await sourceFiles()) {
      const source = await readFile(file, 'utf8')
      for (const hit of findUnawaitedPlugin(source)) {
        offenders.push(`${relative(workspaceRoot, file)}:${hit.line}  ${hit.text}`)
      }
    }
    expect(
      offenders,
      `un-awaited ctx.plugin() — readiness is not propagated to the caller:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
