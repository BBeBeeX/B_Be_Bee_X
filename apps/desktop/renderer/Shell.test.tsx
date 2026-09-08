// @vitest-environment jsdom
/**
 * The pane that renders other people's code.
 *
 * The shell resolves a contributed route to a view it did not write and
 * renders it. Two of the three outcomes are normal — a view, or a placeholder
 * where a target has none — and the third is a view that throws, which used to
 * take the whole window with it: React unmounts the root when a render throws
 * uncaught, so the app became the body's background colour with the reason
 * visible only in devtools.
 */

import { describe, expect, it } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { Context, Service } from 'cordis'
import { Shell } from './Shell.js'

/** Just the slice of `ctx.ui` the shell reads. */
class UiStub extends Service {
  readonly views = new Map<string, unknown>()
  routes: { kind: 'route'; id: string; path: string; title: string }[] = []
  settings: never[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  viewFor(id: string) {
    return this.views.get(id)
  }
}

async function mount(register: (ui: UiStub) => void) {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await new Promise((resolve) => setTimeout(resolve, 10))
  register(ctx.ui as unknown as UiStub)

  // The context the shell is really given: `app.ready(['ui'])`, which has
  // `ui` injected and nothing else.
  const shellCtx = await new Promise<Context>((resolve) => {
    void ctx.inject(['ui'], (scoped) => void resolve(scoped))
  })
  await new Promise((resolve) => setTimeout(resolve, 10))

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(h(Shell, { ctx: shellCtx })))
  return { container, root }
}

const route = (id: string, title: string) =>
  ({ kind: 'route' as const, id, path: `/${id}`, title })

describe('the desktop shell', () => {
  it('renders a contributed view', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('good', 'Good')]
      ui.views.set('good', () => h('p', null, 'the view rendered'))
    })
    expect(container.textContent).toContain('the view rendered')
  })

  it('keeps a throwing view from taking the whole app down', async () => {
    /*
     * ⚠️ The regression this file exists for. Before the boundary, this test
     * left `container` empty — React had unmounted everything, which on a real
     * window is a black page with no sidebar and no way back.
     */
    const { container } = await mount((ui) => {
      ui.routes = [route('bad', 'Bad')]
      ui.views.set('bad', () => {
        throw new Error('cannot get property "inspector" without inject')
      })
    })

    // The failure is named, and it says which view failed.
    expect(container.textContent).toContain('"Bad" failed to render')
    expect(container.textContent).toContain('without inject')
    // And the app is still there: the sidebar survived.
    expect(container.textContent).toContain('BBeBee')
  })

  it('says so when a contribution has no view on this target', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('viewless', 'Viewless')]
    })
    expect(container.textContent).toContain('has no desktop view')
  })
})
