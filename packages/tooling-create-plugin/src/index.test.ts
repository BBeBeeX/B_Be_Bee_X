/**
 * The scaffolder's output.
 *
 * `render` is pure, so the shape of a generated package is checkable without
 * touching disk. The properties asserted here are the ones a hand-rolled
 * plugin gets wrong — and that fail silently when they do.
 */

import { describe, expect, it } from 'vitest'
import { packageNameFor, render, serviceNameFor } from './index.js'

const base = { root: '/tmp', name: 'scrobble', kind: 'feature' as const, ui: 'none' as const }
const fileNamed = (files: ReturnType<typeof render>, suffix: string) =>
  files.find((f) => f.path.endsWith(suffix))!

describe('naming', () => {
  it('prefixes by kind', () => {
    expect(packageNameFor('feature', 'scrobble')).toBe('plugin-scrobble')
    expect(packageNameFor('source', 'subsonic')).toBe('plugin-source-subsonic')
    expect(packageNameFor('effect', 'eq10')).toBe('plugin-effect-eq10')
  })

  it('camel-cases the service key', () => {
    expect(serviceNameFor('log-buffer')).toBe('logBuffer')
  })

  it('rejects a name that is not a slug', () => {
    for (const bad of ['Scrobble', 'plugin_x', '9lives', '@scope/x']) {
      expect(() => render({ ...base, name: bad }), bad).toThrow(/must match/)
    }
  })
})

describe('generated headless package', () => {
  const files = render(base)

  it('emits a manifest, tsconfigs, source and a test', () => {
    for (const suffix of [
      'package.json',
      'BBeBee.plugin.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'src/index.ts',
      'src/index.test.ts',
    ]) {
      expect(files.some((f) => f.path.endsWith(suffix)), suffix).toBe(true)
    }
  })

  it('awaits its child plugin', () => {
    // The defect that bit twice while building M0: an un-awaited child does
    // not propagate readiness. The template must not teach it.
    const source = fileNamed(files, 'src/index.ts').contents
    expect(source).toContain('await ctx.plugin(')
    expect(source).not.toMatch(/\n\s*const fiber = ctx\.plugin\(/)
  })

  it('ships a leak test, not just a smoke test', () => {
    const test = fileNamed(files, 'src/index.test.ts').contents
    expect(test).toContain('diffSnapshots')
  })

  it('depends only on the contract layer', () => {
    // docs/02 §1 — no package outside core-* may import a platform SDK.
    const pkg = JSON.parse(fileNamed(files, 'package.json').contents) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@BBeBee/kernel',
      '@BBeBee/protocol',
      'cordis',
    ])
  })

  it('marks a source plugin instantiable and a feature plugin not', () => {
    const manifestOf = (kind: 'feature' | 'source') =>
      JSON.parse(
        fileNamed(render({ ...base, kind }), 'BBeBee.plugin.json').contents,
      ) as { instantiable: boolean }
    // One plugin, many servers (docs/06 §2).
    expect(manifestOf('source').instantiable).toBe(true)
    expect(manifestOf('feature').instantiable).toBe(false)
  })
})

describe('view packages', () => {
  it('emits none by default', () => {
    expect(render(base).some((f) => f.path.includes('-ui-'))).toBe(false)
  })

  it('emits one per requested target, and records them in the manifest', () => {
    const files = render({ ...base, ui: 'both' })
    expect(files.some((f) => f.path.includes('plugin-scrobble-ui-desktop'))).toBe(true)
    expect(files.some((f) => f.path.includes('plugin-scrobble-ui-mobile'))).toBe(true)

    const manifest = JSON.parse(fileNamed(files, 'BBeBee.plugin.json').contents) as {
      entry: { ui?: { desktop?: string; mobile?: string } }
    }
    expect(manifest.entry.ui?.desktop).toBeDefined()
    expect(manifest.entry.ui?.mobile).toBeDefined()
  })

  it('gives a view package a type-only dependency on the headless one', () => {
    const files = render({ ...base, ui: 'desktop' })
    const pkg = JSON.parse(
      files.find((f) => f.path === 'packages/plugin-scrobble-ui-desktop/package.json')!.contents,
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    // Views take the headless package as a dev dependency: types, not values.
    expect(pkg.devDependencies['@BBeBee/plugin-scrobble']).toBe('workspace:*')
    expect(pkg.dependencies['@BBeBee/plugin-scrobble']).toBeUndefined()
  })
})
