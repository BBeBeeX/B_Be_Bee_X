// @vitest-environment jsdom
/**
 * The hooks the import and debug screens are made of.
 *
 * Written once and consumed by both shells, so a bug here is a bug twice.
 * These are tested against a real `ctx.sources` rather than a mock: the
 * behaviours that matter — what a failed paste leaves on screen, whether a
 * trace stops appending when the user moves on — are about the *interaction*
 * with the service, which a mock would define away.
 */

import { act, render } from '@testing-library/react'
import { createElement as h, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'
import { useSourceEditor, useSourceImport, type EditorState, type ImportState } from './hooks.js'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-hooks') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(plugin, {})
  await tick()
  return ctx
}

const DOC = {
  sourceUrl: 'https://music.example.org',
  sourceName: 'Example',
  ruleStream: { url: '={{source.url}}/s' },
}

/** Renders a hook and hands back its latest value. */
function harnessFor<T>(use: () => T): { current: () => T; rerender: () => void } {
  let latest: T
  const Probe = (): ReactElement => {
    latest = use()
    return h('div')
  }
  const view = render(h(Probe))
  return {
    current: () => latest,
    rerender: () => view.rerender(h(Probe)),
  }
}

describe('useSourceImport', () => {
  it('previews what a paste would add, before anything is written', async () => {
    /*
     * A user pasting a set from a forum has no way to know what is in it, and
     * an import that silently adds eleven sources is one they cannot undo
     * without knowing which eleven.
     */
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText(JSON.stringify([DOC, { ...DOC, sourceUrl: 'https://b.example', sourceName: 'B' }])))
    probe.rerender()

    expect(state.preview).toEqual({ count: 2, names: ['Example', 'B'] })
    expect(ctx.sources.sources, 'nothing written yet').toHaveLength(0)
  })

  it('says nothing about a half-typed paste', async () => {
    // A partial document is not an error yet; problems are reported when the
    // user says they are finished.
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText('{"sourceUrl": "https://'))
    probe.rerender()
    expect(state.preview).toBeUndefined()
    expect(state.issues).toEqual([])
  })

  it('imports, reports, and clears the box', async () => {
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText(JSON.stringify(DOC)))
    probe.rerender()
    await act(async () => {
      state.submit()
      await tick()
      await tick()
    })
    probe.rerender()

    expect(state.report?.added.map((r) => r.name)).toEqual(['Example'])
    expect(state.text, 'cleared on success').toBe('')
  })

  it('keeps a failed paste on screen, with every issue', async () => {
    /*
     * Clearing the box on failure loses the thing the user was trying to fix.
     * And one issue at a time is the misery the multi-issue error exists to
     * avoid — the screen lists them all.
     */
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText('{"sourceName": 42}'))
    probe.rerender()
    await act(async () => {
      state.submit()
      await tick()
      await tick()
    })
    probe.rerender()

    expect(state.text, 'still there to fix').toBe('{"sourceName": 42}')
    expect(state.issues.length).toBeGreaterThan(1)
    expect(state.issues.map((i) => i.path)).toContain('sourceUrl')
  })

  it('reset clears everything, including the last report', async () => {
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText('nonsense'))
    await act(async () => {
      state.submit()
      await tick()
    })
    act(() => state.reset())
    probe.rerender()

    expect(state).toMatchObject({ text: '', issues: [], report: undefined })
  })
})

describe('useSourceEditor', () => {
  it('starts from the stored document, byte for byte', async () => {
    // The editor shows what was imported, not a re-serialisation of it: key
    // order and spacing are the author's, and rewriting them makes every save
    // look like a change.
    const ctx = await harness()
    const text = JSON.stringify(DOC, null, 2)
    await ctx.sources.import(text)
    await tick()

    let state!: EditorState
    harnessFor(() => (state = useSourceEditor(ctx, ctx.sources.sources[0]!.id)))
    expect(state.text).toBe(text)
    expect(state.dirty).toBe(false)
  })

  it('tracks dirtiness, and reverts', async () => {
    const ctx = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    let state!: EditorState
    const probe = harnessFor(() => (state = useSourceEditor(ctx, ctx.sources.sources[0]!.id)))
    act(() => state.setText('edited'))
    probe.rerender()
    expect(state.dirty).toBe(true)

    act(() => state.revert())
    probe.rerender()
    expect(state.dirty).toBe(false)
  })

  it('saves in place, keeping the source id', async () => {
    /*
     * docs/06 §10: the fix is an edit, not a re-import cycle. Saving through
     * `import` dedupes on `sourceUrl`, so the id survives — and with it every
     * URN, cached row, cookie jar and playlist reference.
     */
    const ctx = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    const id = ctx.sources.sources[0]!.id

    let state!: EditorState
    const probe = harnessFor(() => (state = useSourceEditor(ctx, id)))
    act(() => state.setText(JSON.stringify({ ...DOC, sourceName: 'Renamed' })))
    await act(async () => {
      state.save()
      await tick()
      await tick()
    })
    probe.rerender()

    expect(ctx.sources.sources).toHaveLength(1)
    expect(ctx.sources.sources[0]!.id).toBe(id)
    expect(ctx.sources.sources[0]!.name).toBe('Renamed')
    expect(state.dirty, 'saved, so no longer dirty').toBe(false)
  })

  it('reports a broken edit without discarding it', async () => {
    const ctx = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    let state!: EditorState
    const probe = harnessFor(() => (state = useSourceEditor(ctx, ctx.sources.sources[0]!.id)))
    act(() => state.setText('{ not json'))
    await act(async () => {
      state.save()
      await tick()
      await tick()
    })
    probe.rerender()

    expect(state.error).toBeTruthy()
    expect(state.text, 'the broken edit is still there').toBe('{ not json')
  })
})

describe('useSourceEditor, when a save does not take', () => {
  it('stays dirty when the document is rejected', async () => {
    /*
     * ⚠️ A rejected entry arrives *in the report*, not as a throw. So a save
     * that changed nothing resolved successfully, the editor cleared its dirty
     * flag, and the user's fix was silently lost while the screen said it was
     * saved.
     */
    const ctx = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    let state!: EditorState
    const probe = harnessFor(() => (state = useSourceEditor(ctx, ctx.sources.sources[0]!.id)))
    act(() => state.setText(JSON.stringify({ sourceName: 42 })))
    await act(async () => {
      state.save()
      await tick()
      await tick()
    })
    probe.rerender()

    expect(state.error, 'the reason is shown').toBeTruthy()
    expect(state.dirty, 'and the edit is still unsaved').toBe(true)
  })

  it('still reports a genuine save as saved', async () => {
    const ctx = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    let state!: EditorState
    const probe = harnessFor(() => (state = useSourceEditor(ctx, ctx.sources.sources[0]!.id)))
    act(() => state.setText(JSON.stringify({ ...DOC, sourceName: 'Fixed' })))
    await act(async () => {
      state.save()
      await tick()
      await tick()
    })
    probe.rerender()

    expect(state.error).toBeUndefined()
    expect(state.dirty).toBe(false)
  })
})
