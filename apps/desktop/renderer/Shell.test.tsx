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

import { describe, expect, it, vi } from 'vitest'
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
  return { container, root, ctx: shellCtx }
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

  it('switches views when ui/navigate is emitted', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('first', 'First'), route('second', 'Second')]
      ui.views.set('first', () => h('p', null, 'first view'))
      ui.views.set('second', () => h('p', null, 'second view'))
    })
    expect(container.textContent).toContain('first view')
    await act(async () => {
      ctx.emit('ui/navigate', 'second')
    })
    expect(container.textContent).toContain('second view')
  })

  it('opens and closes fullscreen now playing page', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('queue', 'Queue'), route('now-playing.view', 'Now playing')]
      ui.views.set('queue', () => h('p', null, 'queue view'))
      ui.views.set('now-playing.view', ({ onClose }: { onClose?: () => void }) =>
        h(
          'div',
          null,
          h('p', null, 'now playing fullscreen view'),
          h('button', { 'aria-label': 'Close now playing', onClick: onClose }, 'Close'),
        ),
      )
      ui.views.set('now-playing.bar', () => h('div', null, 'bottom bar'))
    })

    expect(container.textContent).toContain('queue view')
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).toBeNull()

    // Navigate to now-playing
    await act(async () => {
      ctx.emit('ui/navigate', 'now-playing.view')
    })

    expect(container.textContent).toContain('now playing fullscreen view')
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="fullscreen-top-bar"]')).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="fullscreen-top-bar"] button[aria-label="Minimize window"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="fullscreen-top-bar"] button[aria-label="Maximize window"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="fullscreen-top-bar"] button[aria-label="Close window"]',
      ),
    ).not.toBeNull()
    expect(container.querySelector('[data-testid="hover-bottom-bar-container"]')).not.toBeNull()

    // Click close button
    const closeBtn = container.querySelector(
      'button[aria-label="Close now playing"]',
    ) as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    await act(async () => {
      closeBtn.click()
    })

    // Closed, returns to queue view
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).toBeNull()
    expect(container.textContent).toContain('queue view')
  })

  it('renders in-app Spotify-style top bar with controls', async () => {
    const minimizeMock = vi.fn()
    const maximizeMock = vi.fn().mockResolvedValue(true)
    const closeMock = vi.fn()

    ;(window as any).BBeBee = {
      window: {
        minimize: minimizeMock,
        maximize: maximizeMock,
        close: closeMock,
        isMaximized: vi.fn().mockResolvedValue(false),
      },
    }

    const { container } = await mount((ui) => {
      ui.routes = [route('home', 'Home')]
      ui.views.set('home', () => h('p', null, 'home page'))
    })

    const header = container.querySelector('header[aria-label="Application Header"]')
    expect(header).not.toBeNull()

    // Left controls: More, Back, Forward
    const moreBtn = container.querySelector('button[aria-label="More options"]') as HTMLButtonElement
    const backBtn = container.querySelector('button[aria-label="Go back"]') as HTMLButtonElement
    const forwardBtn = container.querySelector('button[aria-label="Go forward"]') as HTMLButtonElement
    expect(moreBtn).not.toBeNull()
    expect(backBtn).not.toBeNull()
    expect(forwardBtn).not.toBeNull()

    // Center controls: Home, Search
    const homeBtn = container.querySelector('button[aria-label="Home"]') as HTMLButtonElement
    const searchInput = container.querySelector('input[aria-label="Search"]') as HTMLInputElement
    expect(homeBtn).not.toBeNull()
    expect(searchInput).not.toBeNull()

    // Right controls: Profile, Minimize, Maximize, Close
    const profileBtn = container.querySelector('button[aria-label="User profile"]') as HTMLButtonElement
    const minBtn = container.querySelector('button[aria-label="Minimize window"]') as HTMLButtonElement
    const maxBtn = container.querySelector('button[aria-label="Maximize window"]') as HTMLButtonElement
    const closeBtn = container.querySelector('button[aria-label="Close window"]') as HTMLButtonElement
    expect(profileBtn).not.toBeNull()
    expect(minBtn).not.toBeNull()
    expect(maxBtn).not.toBeNull()
    expect(closeBtn).not.toBeNull()

    // Test window controls click
    await act(async () => {
      minBtn.click()
      maxBtn.click()
      closeBtn.click()
    })
    expect(minimizeMock).toHaveBeenCalledTimes(1)
    expect(maximizeMock).toHaveBeenCalledTimes(1)
    expect(closeMock).toHaveBeenCalledTimes(1)

    // Test more options dropdown
    await act(async () => {
      moreBtn.click()
    })
    expect(container.textContent).toContain('Settings')
  })

  it('applies rounded card layout with dark grey background and gaps', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('home', 'Home')]
      ui.views.set('home', () => h('p', null, 'home page'))
      ui.views.set('now-playing.bar', () => h('div', null, 'player bar'))
    })

    const nav = container.querySelector('nav') as HTMLElement
    const main = container.querySelector('main') as HTMLElement
    const footer = container.querySelector('footer') as HTMLElement
    expect(nav).not.toBeNull()
    expect(main).not.toBeNull()
    expect(footer).not.toBeNull()

    // Left and right panels: #121212 background, 8px border radius
    expect(nav.style.backgroundColor).toBe('rgb(18, 18, 18)')
    expect(nav.style.borderRadius).toBe('8px')
    expect(main.style.backgroundColor).toBe('rgb(18, 18, 18)')
    expect(main.style.borderRadius).toBe('8px')

    // Bottom bar: #000000 background
    expect(footer.style.backgroundColor).toBe('rgb(0, 0, 0)')

    // Workspace container: 8px gap and 8px padding
    const workspace = nav.parentElement as HTMLElement
    expect(workspace).not.toBeNull()
    expect(workspace.style.gap).toBe('8px')
    expect(workspace.style.padding).toBe('8px')
  })

  it('navigates right pane to album view while keeping sidebar intact', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('sources.library', 'Library')]
      ui.views.set('sources.library', ({ onOpenAlbum }: { onOpenAlbum?: (urn: string) => void }) =>
        h(
          'div',
          null,
          h('p', null, 'library list'),
          h(
            'button',
            {
              'aria-label': 'Test Album',
              onClick: () => onOpenAlbum?.('BBeBee:local:album:test-42'),
            },
            'Open Album',
          ),
        ),
      )
      ui.views.set('album.view', ({ urn }: { urn?: string }) =>
        h('div', { 'data-testid': 'album-screen' }, `Album Detail: ${urn}`),
      )
    })

    expect(container.textContent).toContain('library list')
    const nav = container.querySelector('nav')
    expect(nav).not.toBeNull()
    expect(nav?.textContent).toContain('Library')

    // Click album to navigate
    const albumBtn = container.querySelector('button[aria-label="Test Album"]') as HTMLButtonElement
    expect(albumBtn).not.toBeNull()
    await act(async () => {
      albumBtn.click()
    })

    // Right pane is now album screen with correct URN
    expect(container.textContent).toContain('Album Detail: BBeBee:local:album:test-42')
    // Sidebar is still mounted and intact
    expect(container.querySelector('nav')).toBe(nav)
    expect(nav?.textContent).toContain('Library')
  })

  it('controls right-side route history via TopBar Back, Forward, and Home buttons', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [
        route('home', 'Home'),
        route('page-a', 'Page A'),
        route('page-b', 'Page B'),
      ]
      ui.views.set('home', () => h('p', null, 'Home Screen'))
      ui.views.set('page-a', () => h('p', null, 'Page A Content'))
      ui.views.set('page-b', () => h('p', null, 'Page B Content'))
    })

    const backBtn = container.querySelector('button[aria-label="Go back"]') as HTMLButtonElement
    const forwardBtn = container.querySelector('button[aria-label="Go forward"]') as HTMLButtonElement
    const homeBtn = container.querySelector('button[aria-label="Home"]') as HTMLButtonElement

    // Initial state: on Home, cannot go back or forward
    expect(container.textContent).toContain('Home Screen')
    expect(backBtn.disabled).toBe(true)
    expect(forwardBtn.disabled).toBe(true)

    // Navigate to Page A
    await act(async () => {
      ctx.emit('ui/navigate', 'page-a')
    })
    expect(container.textContent).toContain('Page A Content')
    expect(backBtn.disabled).toBe(false)
    expect(forwardBtn.disabled).toBe(true)

    // Navigate to Page B
    await act(async () => {
      ctx.emit('ui/navigate', 'page-b')
    })
    expect(container.textContent).toContain('Page B Content')
    expect(backBtn.disabled).toBe(false)
    expect(forwardBtn.disabled).toBe(true)

    // Click Back: returns to Page A
    await act(async () => {
      backBtn.click()
    })
    expect(container.textContent).toContain('Page A Content')
    expect(backBtn.disabled).toBe(false)
    expect(forwardBtn.disabled).toBe(false)

    // Click Back again: returns to Home
    await act(async () => {
      backBtn.click()
    })
    expect(container.textContent).toContain('Home Screen')
    expect(backBtn.disabled).toBe(true)
    expect(forwardBtn.disabled).toBe(false)

    // Click Forward: returns to Page A
    await act(async () => {
      forwardBtn.click()
    })
    expect(container.textContent).toContain('Page A Content')
    expect(backBtn.disabled).toBe(false)
    expect(forwardBtn.disabled).toBe(false)

    // Click Home: navigates back to Home
    await act(async () => {
      homeBtn.click()
    })
    expect(container.textContent).toContain('Home Screen')
    expect(backBtn.disabled).toBe(false)
  })
})
