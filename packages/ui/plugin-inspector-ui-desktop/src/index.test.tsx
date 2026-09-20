// @vitest-environment jsdom
/**
 * The inspector view, rendered the way the shell renders it.
 *
 * ⚠️ **The context the view is handed is the whole point of this file.**
 * `main.tsx` mounts the shell with `app.ready(['ui'])` — a scoped context that
 * has `ui` injected and *nothing else* — and the shell passes that to every
 * view as `props.ctx`. A cordis context throws for any property not in its
 * inject list, so a screen reading `ctx.inspector` off it throws during render,
 * and with no error boundary above the shell React unmounts the whole tree: the
 * page goes black, with the failure visible only in devtools.
 *
 * A test that builds a plain root `Context` cannot see any of that — the read
 * simply answers there — which is exactly how this shipped. So the harness
 * below goes through `ctx.inject(['ui'], …)`, and the view is fetched from the
 * registry rather than imported, because what has to hold is the thing the
 * shell actually does.
 */

import { describe, expect, it } from 'vitest'
import { createElement as h, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from 'cordis'
import inspectorPlugin from '@BBeBee/plugin-inspector'
import inspectorUi, { INSPECTOR_VIEW, InspectorPanel } from './index.js'

/** Just the slice of `ctx.ui` this package touches. */
class UiStub extends Service {
  readonly views = new Map<string, unknown>()
  readonly contributions: { kind: string; id: string }[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, view: unknown) {
    this.views.set(id, view)
    return () => void this.views.delete(id)
  }

  viewFor(id: string) {
    return this.views.get(id)
  }

  contribute(contribution: { kind: string; id: string }) {
    this.contributions.push(contribution)
    return () => undefined
  }
}

/** The app context, plus the `ready(['ui'])` context the shell is given. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await ctx.plugin(inspectorPlugin)
  await ctx.plugin(inspectorUi)

  const shellCtx = await new Promise<Context>((resolve) => {
    void ctx.inject(['ui'], (scoped) => void resolve(scoped))
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { ctx, shellCtx }
}

/** What `Shell.tsx` does: look the view up by id and render it with its ctx. */
function renderAsShell(shellCtx: Context): string {
  const View = shellCtx.ui.viewFor(INSPECTOR_VIEW) as ComponentType<{ ctx: Context }> | undefined
  expect(View, 'no view registered for the contributed route').toBeDefined()
  return renderToStaticMarkup(h(View!, { ctx: shellCtx }))
}

describe('the inspector view', () => {
  it('renders the fiber tree when the shell hands it the shell context', async () => {
    const { shellCtx } = await harness()

    // Before the fix this threw `cannot get property "inspector" without
    // inject`, and the page the user saw was the body's background.
    const html = renderAsShell(shellCtx)

    expect(html).toContain('Plugin graph')
    // The graph itself, not just the heading: the root fiber, this plugin's own
    // fiber, and the service the inspector claims.
    expect(html).toContain('root')
    expect(html).toContain('plugin-inspector')
    expect(html).toContain('ACTIVE')
  })

  it('contributes a route the sidebar can reach', async () => {
    const { ctx } = await harness()
    const ui = ctx.ui as unknown as UiStub
    expect(ui.contributions).toContainEqual(
      expect.objectContaining({ kind: 'route', id: INSPECTOR_VIEW }),
    )
  })

  it('shows counts and what a stalled fiber is waiting for', async () => {
    const { ctx, shellCtx } = await harness()

    // A plugin that will never activate — the state the inspector exists to
    // explain, and the one a snapshot of a healthy graph never covers.
    await ctx.plugin({
      name: 'plugin-stuck',
      inject: ['nothing-provides-this'],
      apply: async () => undefined,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const html = renderAsShell(shellCtx)
    expect(html).toContain('plugin-stuck')
    expect(html).toContain('PENDING')
    expect(html).toContain('waiting nothing-provides-this')
  })

  it('unregisters its view when the plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(inspectorPlugin)
    const fiber = await ctx.plugin(inspectorUi)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.ui.viewFor(INSPECTOR_VIEW)).toBeDefined()

    await fiber.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.ui.viewFor(INSPECTOR_VIEW)).toBeUndefined()
  })

  it('still renders when given a context that has the service directly', async () => {
    // The panel is exported, and a caller holding a context with `inspector`
    // available may render it without going through the registry.
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(renderToStaticMarkup(h(InspectorPanel, { ctx }))).toContain('Plugin graph')
  })

  it('renders the 5 PCB visual layers with real plugin nodes and removed obsolete HUD badges', async () => {
    const { shellCtx } = await harness()
    const html = renderAsShell(shellCtx)

    // Obsolete HUD badges and dummy CSxx IDs are removed
    expect(html).not.toContain('EVSERFL12–347')
    expect(html).not.toContain('EVSERFL12-347')
    expect(html).not.toContain('EC1')
    expect(html).not.toContain('EC2')
    expect(html).not.toContain('CORE VCC')
    expect(html).not.toContain('cs20')
    expect(html).not.toContain('cs30')

    // Enlarged Plugin graph header
    expect(html).toContain('Plugin graph')

    // Real plugin nodes rendered
    expect(html).toContain('root')
    expect(html).toContain('plugin-inspector')

    // 5 Visual Layers
    expect(html).toContain('glow-layer')
    expect(html).toContain('trace-layer')
    expect(html).toContain('pin-layer')
    expect(html).toContain('node-layer')
    expect(html).toContain('signal-flow-layer')

    // Orthogonal trace path markers & filters
    expect(html).toContain('pcb-glow')
    expect(html).toContain('pcb-grid-pattern')
  })
})
