/**
 * React Native view for `plugin-hello`.
 *
 * The same descriptor id, the same service, the same hook shape as the desktop
 * package — only the elements differ. That symmetry is the point of ADR-2's
 * three-package convention.
 *
 * `react-native` is imported lazily so this package can be typechecked and
 * unit-tested off-device; the shell provides the real module at runtime.
 */

import { createElement as h, useEffect, useState } from 'react'
import type { Context } from 'cordis'
// Pulls the service augmentations (`ctx.db`, `ctx.ui`, …) into this program.
// Without it a consumer compiling this package in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'
import { HELLO_VIEW, type HelloState } from '@BBeBee/plugin-hello'

export interface NativeElements {
  View: unknown
  Text: unknown
  Pressable: unknown
}

function useHello(ctx: Context): HelloState {
  const [state, setState] = useState<HelloState>(() => ctx.hello.snapshot)
  useEffect(() => {
    const off = ctx.on('hello/changed', setState)
    return () => void off()
  }, [ctx])
  return state
}

export function createHelloPanel(rn: NativeElements) {
  return function HelloPanel({ ctx }: { ctx: Context }) {
    const state = useHello(ctx)
    return h(
      rn.View as never,
      { style: { padding: 24, gap: 8 } },
      h(rn.Text as never, { style: { fontSize: 28, fontWeight: '700' } }, `${state.greeting}, BBeBee`),
      h(rn.Text as never, { style: { color: '#666' } }, state.platformNote),
      h(rn.Text as never, null, `Launches: ${state.launchCount}`),
      h(rn.Text as never, null, `Notes: ${state.noteCount}`),
      h(
        rn.Pressable as never,
        { onPress: () => void ctx.ui.runCommand('hello.addNote'), style: { marginTop: 16 } },
        h(rn.Text as never, { style: { color: '#7C5CFF' } }, 'Add a note'),
      ),
    )
  }
}

export const name = 'plugin-hello-ui-mobile'
export const inject = ['ui', 'hello']

/** The shell passes its `react-native` primitives in, so this file imports none. */
export function createPlugin(rn: NativeElements) {
  const HelloPanel = createHelloPanel(rn)
  return {
    name,
    inject,
    apply(ctx: Context) {
      // Bound to *this plugin's* context, not the one the shell renders with.
      // The shell knows nothing about any feature, so it injects `ui` and
      // nothing else; reading `ctx.hello` through it is what `inject` forbids.
      return ctx.ui.registerView(HELLO_VIEW, () => h(HelloPanel, { ctx }))
    },
  }
}

export default createPlugin
