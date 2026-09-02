/**
 * React DOM view for `plugin-hello`.
 *
 * Contains no logic — every value comes from `ctx.hello`. If an `if` shows up
 * here that also belongs in the mobile view, it belongs in the headless
 * package instead (docs/08 §1).
 */

import { createElement as h, useEffect, useState } from 'react'
import type { Context } from 'cordis'
// Pulls the service augmentations (`ctx.db`, `ctx.ui`, …) into this program.
// Without it a consumer compiling this package in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'
import { HELLO_VIEW, type HelloState } from '@BBeBee/plugin-hello'

/** Subscribe to the service. The shells share this pattern; see docs/08 §4. */
function useHello(ctx: Context): HelloState {
  const [state, setState] = useState<HelloState>(() => ctx.hello.snapshot)
  // `ctx.on` returns () => boolean; React's cleanup must return void.
  useEffect(() => {
    const off = ctx.on('hello/changed', setState)
    return () => void off()
  }, [ctx])
  return state
}

export function HelloPanel({ ctx }: { ctx: Context }) {
  const state = useHello(ctx)
  return h(
    'section',
    { style: { padding: 24, fontFamily: 'system-ui, sans-serif' } },
    h('h1', { style: { margin: '0 0 8px', fontSize: 28 } }, `${state.greeting}, BBeBee`),
    h('p', { style: { margin: '0 0 16px', color: '#666' } }, state.platformNote),
    h(
      'dl',
      { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' } },
      h('dt', null, 'Launches'),
      h('dd', { style: { margin: 0 } }, String(state.launchCount)),
      h('dt', null, 'Notes'),
      h('dd', { style: { margin: 0 } }, String(state.noteCount)),
    ),
    h(
      'button',
      {
        style: { marginTop: 16, padding: '8px 14px' },
        onClick: () => void ctx.ui.runCommand('hello.addNote'),
      },
      'Add a note',
    ),
  )
}

export const name = 'plugin-hello-ui-desktop'
export const inject = ['ui', 'hello']

/**
 * ⚠️ `async` is load-bearing, not decoration.
 *
 * Cordis decides "is this a class?" with `!!func.prototype`. A plain
 * `function apply(…)` has one, so it is `new`-ed as if it were a service and
 * the disposer it returns is discarded — the plugin loads, works, and never
 * unloads. An async function has no prototype. `conventions.test.ts` fails the
 * build on the other shape (docs/03 §2).
 */
export async function apply(ctx: Context) {
  // Bound to *this plugin's* context, not to the one the shell renders with.
  // The shell knows nothing about any feature, so it injects `ui` and nothing
  // else; reading `ctx.hello` through it is what `inject` above forbids.
  return ctx.ui.registerView(HELLO_VIEW, () => h(HelloPanel, { ctx }))
}

export default { name, inject, apply }
