// @vitest-environment jsdom
/**
 * The import and diagnose screens.
 *
 * Rendered against a real `ctx.sources`, because what is worth pinning is the
 * *interaction*: what a paste shows before it commits, and whether a broken
 * document leaves the user something to fix. A mocked service would define
 * both of those away.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import sourcesPlugin from '@BBeBee/plugin-sources'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { DebugScreen, ImportScreen, LibraryScreen, inject } from './index.js'

// Testing Library auto-cleans only with vitest globals, which this repo does
// not enable. Without this every render stacks up in one document and
// `screen` queries find the previous test's screen.
afterEach(cleanup)

/**
 * The context a view actually gets — scoped, not root.
 *
 * ⚠️ This distinction is the whole reason this helper exists. `new Context()`
 * answers `undefined` for a service nobody registered; a **plugin-scoped**
 * context throws `cannot get property "x" without inject` for anything not
 * declared, and a scoped context is the only kind a shell ever hands a view.
 *
 * Every view test in this repo used the root kind, so `ctx.player?.playNow()`
 * read as a safe optional everywhere in CI and threw on a device the moment
 * anyone tapped a track. Rendering against the real shape is what makes that
 * a failing test rather than a bug report.
 */
async function harness(): Promise<{ ctx: Context; admin: Context }> {
  const root = new Context()
  await root.plugin(PathsNode, { root: await tempDir('bbebee-screens') })
  await root.plugin(FsNode)
  await root.plugin(DbNode, { fileName: ':memory:' })
  await root.plugin(sourcesPlugin, {})
  await tick()

  /*
   * Scoped to **this package's own `inject`**, minus `ui` (which the harness
   * does not load and no screen reads).
   *
   * Derived rather than written out, so the two cannot drift: if a screen
   * starts reading a service the package never declared, the read throws here
   * exactly as it would in the app. `admin` is the root, for arranging
   * fixtures the view itself would have no business reaching.
   */
  const declared = inject.filter((name) => name !== 'ui')
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('screens harness: no scoped context')
  return { ctx: scoped, admin: root }
}

const DOC = {
  sourceUrl: 'https://music.example.org',
  sourceName: 'Example',
  ruleStream: { url: '={{source.url}}/s' },
}

function type(testID: string, value: string): void {
  const field = screen.getByTestId(testID) as HTMLTextAreaElement
  // React tracks the last value it wrote, so assigning `.value` directly is
  // ignored on the next render. Going through the native setter is what makes
  // a controlled input see the change.
  const setter = Object.getOwnPropertyDescriptor(
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )!.set!
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ImportScreen', () => {
  it('names what a paste would add, before writing anything', async () => {
    const { ctx } = await harness()
    render(h(ImportScreen, { ctx }))

    await act(async () => {
      type('source-import-input', JSON.stringify([DOC, { ...DOC, sourceUrl: 'https://b.example', sourceName: 'Second' }]))
      await tick()
    })

    expect(screen.getByLabelText('What will be imported')).toBeTruthy()
    expect(screen.getByText('Example')).toBeTruthy()
    expect(screen.getByText('Second')).toBeTruthy()
    expect(ctx.sources.sources, 'nothing written yet').toHaveLength(0)
  })

  it('will not import an empty box', async () => {
    // Disabled rather than erroring: there is nothing to say about a paste
    // that has not happened.
    await harness().then(({ ctx }) => render(h(ImportScreen, { ctx })))
    expect((screen.getByTestId('source-import-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('imports, and says what it did', async () => {
    const { ctx } = await harness()
    render(h(ImportScreen, { ctx }))

    await act(async () => {
      type('source-import-input', JSON.stringify(DOC))
      await tick()
    })
    await act(async () => {
      screen.getByTestId('source-import-submit').click()
      await tick()
      await tick()
    })

    expect(ctx.sources.sources).toHaveLength(1)
    expect(screen.getByText('1 added')).toBeTruthy()
  })

  it('shows every problem with a bad paste, and keeps the text', async () => {
    /*
     * Two things a screen gets wrong here: clearing the box on failure (losing
     * what the user was fixing), and showing one issue at a time (the misery
     * the multi-issue error exists to avoid).
     */
    const { ctx } = await harness()
    render(h(ImportScreen, { ctx }))

    await act(async () => {
      type('source-import-input', '{"sourceName": 42}')
      await tick()
    })
    await act(async () => {
      screen.getByTestId('source-import-submit').click()
      await tick()
      await tick()
    })

    const field = screen.getByTestId('source-import-input') as HTMLTextAreaElement
    expect(field.value, 'still there to fix').toBe('{"sourceName": 42}')
    const shown = document.body.textContent ?? ''
    expect(shown).toContain('sourceUrl')
    expect(shown).toContain('ruleStream')
  })
})

describe('DebugScreen', () => {
  it('offers the document for editing, exactly as stored', async () => {
    const { ctx } = await harness()
    const text = JSON.stringify(DOC, null, 2)
    await ctx.sources.import(text)
    await tick()

    render(h(DebugScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    expect((screen.getByTestId('source-editor') as HTMLTextAreaElement).value).toBe(text)
  })

  it('cannot save until something changed', async () => {
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    render(h(DebugScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    expect((screen.getByTestId('source-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves an edit in place, keeping the source id', async () => {
    // docs/06 §10: the fix is an edit, not a re-import cycle — so every URN,
    // cached row and playlist reference survives it.
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    const id = ctx.sources.sources[0]!.id

    render(h(DebugScreen, { ctx, sourceId: id }))
    await act(async () => {
      type('source-editor', JSON.stringify({ ...DOC, sourceName: 'Renamed' }))
      await tick()
    })
    await act(async () => {
      screen.getByTestId('source-save').click()
      await tick()
      await tick()
    })

    expect(ctx.sources.sources).toHaveLength(1)
    expect(ctx.sources.sources[0]!.id).toBe(id)
    expect(ctx.sources.sources[0]!.name).toBe('Renamed')
  })

  it('says there is no trace yet rather than showing an empty list', async () => {
    // An empty list and "not run yet" look identical, and only one of them
    // means something is wrong.
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    render(h(DebugScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    expect(screen.getByText('No trace yet')).toBeTruthy()
  })
})

describe('LibraryScreen', () => {
  /** A track in the catalogue, written the way the scanner would. */
  async function withTrack(admin: Context): Promise<void> {
    await admin.db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES ('local', 'bbebee://local/local', 'This device', '{}', 'h', 0, 0)`,
    )
    await admin.db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, fetched_at)
       VALUES ('BBeBee:local:track:1', 'local', '1', 'Jóga', 0)`,
    )
  }

  it('plays a track without a player loaded, instead of throwing', async () => {
    /*
     * The device bug, exactly.
     *
     * `ctx.player?.playNow(...)` reads as a safe optional and is not one: on a
     * plugin-scoped context cordis throws for any property that was not
     * injected, so the `?.` never gets the chance to short-circuit. Every test
     * missed it because every test built a *root* context, where the same read
     * answers `undefined`.
     *
     * `plugin-player` is deliberately absent here, which is the ordinary state
     * while it is still loading — and the state a user taps into.
     */
    const { ctx, admin } = await harness()
    await withTrack(admin)

    const container = await withListLayout(async () => {
      const view = render(h(LibraryScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view.container
    })

    const row = container.querySelector('[role="row"]') as HTMLElement | null
    expect(row, 'the track is on screen').toBeTruthy()
    expect(row!.textContent).toContain('Jóga')

    /*
     * Collected, not caught.
     *
     * React dispatches its own events, so a handler that throws does not
     * propagate out of `.click()` — it is reported. That is precisely why this
     * reached a device as a bare `[Error: …]` in LogBox instead of failing
     * anything, and why `expect(...).not.toThrow()` would pass while the bug
     * was still there.
     */
    const reported: unknown[] = []
    const onError = (event: ErrorEvent) => {
      reported.push(event.error ?? event.message)
      event.preventDefault()
    }
    window.addEventListener('error', onError)
    try {
      row!.click()
    } finally {
      window.removeEventListener('error', onError)
    }

    expect(
      reported.map(String),
      'tapping a track with no player must be a no-op, not an uncaught error',
    ).toEqual([])
  })
})
