// @vitest-environment jsdom
/**
 * The scan-roots screen, and whether anyone can reach it.
 *
 * Two different claims, and only the first was ever true:
 *
 *  - The screen has a *Scan now* button that calls `ctx.scanner.scan()`.
 *  - Something in the app can navigate to the screen.
 *
 * `plugin-local-scanner` contributes it as a **settings** page, and both
 * shells read only `ctx.ui.routes` — so the button existed, had a view bound
 * to it, and could not be pressed. A contribution nothing renders is a feature
 * nobody has, which is why the reachability half is pinned here rather than
 * left to a device run.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { CodecNode } from '@BBeBee/core-codec-node'
import uiPlugin from '@BBeBee/plugin-ui'
import scannerPlugin from '@BBeBee/plugin-local-scanner'
import { SCANNER_VIEWS } from '@BBeBee/plugin-local-scanner/views'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { ScanRootsScreen, inject } from './index.js'
import plugin from './index.js'

afterEach(cleanup)

/** The real scanner and the real `ctx.ui`, so both claims are about real wiring. */
async function harness(): Promise<{ ctx: Context; admin: Context }> {
  const root = new Context()
  await root.plugin(PathsNode, { root: await tempDir('bbebee-scan-ui') })
  await root.plugin(FsNode)
  await root.plugin(DbNode, { fileName: ':memory:' })
  // `plugin-local-scanner` requires `codec`; without it the plugin never
  // activates and `ctx.scanner` never appears.
  await root.plugin(CodecNode)
  await root.plugin(uiPlugin)
  await root.plugin(scannerPlugin)
  await tick()

  // Scoped to what this package declares, so a screen reading an undeclared
  // service throws here exactly as it would in the app.
  const declared = inject.filter((name) => name !== 'ui')
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  // The scanner's init is genuinely async — it writes its source row, loads
  // its roots and starts watching — so the inject callback lands a few turns
  // later rather than on the next microtask.
  for (let i = 0; i < 20 && !scoped; i++) await tick()
  if (!scoped) throw new Error('scan-ui harness: no scoped context')
  return { ctx: scoped, admin: root }
}

/** The button whose accessible name or label matches. */
function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text,
  )
}

describe('the scan screen is reachable', () => {
  it('is contributed as a settings page with a view bound to it', async () => {
    const { admin } = await harness()
    await admin.plugin(plugin)
    await tick()

    const settings = admin.ui.settings.map((s) => s.id)
    expect(settings, 'the scanner contributes a settings page').toContain(SCANNER_VIEWS.settings)
    expect(
      admin.ui.viewFor(SCANNER_VIEWS.settings),
      'and this package binds a view to it — the pair a shell needs to render it',
    ).toBeDefined()
  })

  it('is not left out of missingViews, which is how a shell reports a hole', async () => {
    // Before the view package loads, the contribution is a hole. After, it is
    // not. Both halves matter: the first is what the shell must be able to
    // report, the second is what this package exists to fill.
    const { admin } = await harness()
    expect(admin.ui.missingViews()).toContain(SCANNER_VIEWS.settings)

    await admin.plugin(plugin)
    await tick()
    expect(admin.ui.missingViews()).not.toContain(SCANNER_VIEWS.settings)
  })
})

describe('ScanRootsScreen', () => {
  it('offers a scan button that starts a scan', async () => {
    const { ctx } = await harness()
    const scan = vi.spyOn(ctx.scanner, 'scan')

    const { container } = await withListLayout(async () => {
      const view = render(h(ScanRootsScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view
    })

    const button = buttonNamed(container, 'Scan now')
    expect(button, 'the screen has a scan button').toBeTruthy()

    await act(async () => {
      button!.click()
      await tick()
    })
    expect(scan, 'pressing it walks the roots').toHaveBeenCalled()
  })

  it('offers a way to add a folder, since a scan with no roots does nothing', async () => {
    const { ctx } = await harness()
    const { container } = await withListLayout(async () => {
      const view = render(h(ScanRootsScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view
    })

    expect(buttonNamed(container, 'Add folder')).toBeTruthy()
    expect(container.textContent, 'and says so while there are none').toContain('No folders yet')
  })

  /**
   * The button that reads a *second* service, which is where this went wrong.
   *
   * The screen's state comes from `ctx.scanner`, so rendering it proved
   * nothing about `ctx.fs` — and `addFolder` is the only place that touches
   * it. Pressing it on a scoped context is the whole test: an undeclared read
   * throws `cannot get property "fs" without inject`, which is what a device
   * reported while the render tests above stayed green.
   */
  it('picks a folder through ctx.fs, which it may only reach if it declares it', async () => {
    const { ctx, admin } = await harness()
    const dir = await tempDir('bbebee-picked-root')
    // Spied through the root context: the same service instance the scoped
    // `ctx` resolves, but reachable here without `inject` in the way. `FsNode`
    // has no dialog to open, so the picked uri has to come from the stub.
    const pick = vi.spyOn(admin.fs, 'pickDirectory').mockResolvedValue(`file://${dir}`)
    const addRoot = vi.spyOn(ctx.scanner, 'addRoot')

    const { container } = await withListLayout(async () => {
      const view = render(h(ScanRootsScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view
    })

    await act(async () => {
      buttonNamed(container, 'Add folder')!.click()
      await tick()
      await tick()
    })

    expect(pick, 'the picker is what carries the permission grant').toHaveBeenCalled()
    expect(addRoot, 'and what it returns becomes a scan root').toHaveBeenCalledWith(`file://${dir}`)
  })

  it('shows a folder that was added, and a way to remove it', async () => {
    const { ctx } = await harness()
    const dir = await tempDir('bbebee-scan-root')
    await ctx.scanner.addRoot(`file://${dir}`)

    const { container } = await withListLayout(async () => {
      const view = render(h(ScanRootsScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view
    })

    expect(container.textContent).toContain(dir)
    expect(buttonNamed(container, `Remove file://${dir}`)).toBeTruthy()
  })
})
