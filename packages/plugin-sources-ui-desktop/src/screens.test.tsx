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
import { DebugScreen, ImportScreen } from './index.js'

// Testing Library auto-cleans only with vitest globals, which this repo does
// not enable. Without this every render stacks up in one document and
// `screen` queries find the previous test's screen.
afterEach(cleanup)

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-screens') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  return ctx
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
    const ctx = await harness()
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
    await harness().then((ctx) => render(h(ImportScreen, { ctx })))
    expect((screen.getByTestId('source-import-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('imports, and says what it did', async () => {
    const ctx = await harness()
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
    const ctx = await harness()
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
    const ctx = await harness()
    const text = JSON.stringify(DOC, null, 2)
    await ctx.sources.import(text)
    await tick()

    render(h(DebugScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    expect((screen.getByTestId('source-editor') as HTMLTextAreaElement).value).toBe(text)
  })

  it('cannot save until something changed', async () => {
    const ctx = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    render(h(DebugScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    expect((screen.getByTestId('source-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves an edit in place, keeping the source id', async () => {
    // docs/06 §10: the fix is an edit, not a re-import cycle — so every URN,
    // cached row and playlist reference survives it.
    const ctx = await harness()
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
    const ctx = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    render(h(DebugScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    expect(screen.getByText('No trace yet')).toBeTruthy()
  })
})
