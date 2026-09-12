/**
 * React DOM views for `plugin-local-scanner`.
 *
 * The scan-root settings screen: which folders, what happened last time, and
 * a way to start a walk. Layout and wiring only — the progress bookkeeping is
 * in `plugin-local-scanner/hooks`, shared with the mobile twin (docs/08 1).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { ScanSpecifiedDir } from '@BBeBee/protocol'
import { SCANNER_VIEWS } from '@BBeBee/plugin-local-scanner/views'
import { summarise, useScanSpecifiedDirs, useScanState } from '@BBeBee/plugin-local-scanner/hooks'
import { Button, EmptyState, IconButton, List, Text } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

export function ScanSpecifiedDirsScreen({ ctx }: { ctx: Context }): ReactElement {
  const dirs = useScanSpecifiedDirs(ctx)
  const scan = useScanState(ctx)

  const addFolder = async () => {
    // The picker is what carries a durable permission grant on Android; a
    // typed path would not, so there is deliberately no text field here.
    const uri = await ctx.fs.pickDirectory()
    if (uri) {
      const dir = await ctx.scanner.addSpecifiedDir(uri)
      void ctx.scanner.scan({ specifiedDirId: dir.id })
    }
  }

  return h(
    'section',
    { style: { padding: tokens.space[4], display: 'flex', flexDirection: 'column', gap: tokens.space[3] } },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(Text, { variant: 'lg', children: 'Music folders' }),
      h(Button, { onPress: () => void addFolder(), children: 'Add folder' }),
      h(Button, {
        variant: 'secondary',
        // Disabled while running rather than hidden: a control that vanishes
        // mid-scan makes the screen look like it lost the button.
        disabled: scan.running,
        onPress: () => void ctx.scanner.scan(),
        accessibilityLabel: 'Scan now',
        children: scan.running ? 'Scanning…' : 'Scan now',
      }),
      scan.running
        ? h(Button, {
            variant: 'ghost',
            onPress: () => ctx.scanner.cancel(),
            children: 'Cancel',
          })
        : null,
    ),
    // Progress per batch, not per scan: a large library takes minutes, and a
    // screen that only learned the outcome would look frozen throughout.
    scan.progress
      ? h(Text, {
          tone: 'muted',
          accessibilityLabel: 'Scan progress',
          children: scan.progress.total
            ? `Scanned ${scan.progress.done} of ${scan.progress.total}`
            : `Scanned ${scan.progress.done} files`,
        })
      : scan.lastSummary
        ? h(Text, {
            tone: scan.lastSummary.errors > 0 ? 'warn' : 'muted',
            children: `Last scan: ${summarise(scan.lastSummary)}`,
          })
        : null,
    h(List<ScanSpecifiedDir>, {
      items: dirs,
      accessibilityLabel: 'Music folders',
      estimatedItemSize: tokens.size.row,
      keyExtractor: (dir) => dir.id,
      empty: h(EmptyState, {
        icon: '📁',
        title: 'No folders yet',
        description: 'Add one and its music appears in your library as it is scanned.',
      }),
      renderItem: (dir) =>
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[3],
              height: tokens.size.row,
              opacity: dir.enabled ? 1 : 0.5,
            },
          },
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h(Text, { numberOfLines: 1, children: dir.uri }),
            // The reason a folder failed, kept in front of the user rather
            // than only in a log they will never open.
            dir.lastError
              ? h(Text, { variant: 'sm', tone: 'error', numberOfLines: 1, children: dir.lastError })
              : null,
          ),
          h(Button, {
            variant: 'ghost',
            disabled: scan.running || !dir.enabled,
            onPress: () => void ctx.scanner.scan({ specifiedDirId: dir.id }),
            accessibilityLabel: `Scan ${dir.uri}`,
            children: 'Scan',
          }),
          h(Button, {
            variant: 'ghost',
            onPress: () => void ctx.scanner.setEnabled(dir.id, !dir.enabled),
            accessibilityLabel: dir.enabled ? `Disable ${dir.uri}` : `Enable ${dir.uri}`,
            children: dir.enabled ? 'Disable' : 'Enable',
          }),
          h(IconButton, {
            icon: '🗑',
            // Removing a specified dir keeps its tracks by default: losing a library
            // to a mis-clicked button is far worse than a stale row.
            accessibilityLabel: `Remove ${dir.uri}`,
            onPress: () => void ctx.scanner.removeSpecifiedDir(dir.id),
          }),
        ),
    }),
    h(Text, {
      variant: 'sm',
      tone: 'muted',
      children: 'Removing a folder keeps the tracks it found. Nothing is deleted from disk.',
    }),
  )
}

export const name = 'plugin-local-scanner-ui-desktop'

/**
 * Bind a screen to *this* plugin's context, not the shell's.
 *
 * ⚠️ The shell renders a view as `h(Component, { ctx })` with **its own**
 * context — the one it got from `app.ready(['ui'])`, which has `ui` injected
 * and nothing else. A cordis context throws for any property that was not
 * injected, so a screen reading `ctx.scanner` through its hooks threw
 * `cannot get property "scanner" without inject` on a device while every
 * test passed, because tests built a root context where that read answers
 * `undefined` instead.
 *
 * Registering a closure over the context this plugin was applied with is the
 * fix, and it is what every view package here does: the screen runs on a
 * context with exactly what this package's `inject` declares. The shell's
 * props are still forwarded, so a view that takes more than `ctx` keeps
 * working.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  // `h(Screen, …)`, not `Screen(…)`: calling a component as a function splices
  // its hooks into this one's list, which works right up until someone renders
  // it conditionally. An element keeps them separate.
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}


export const inject = ['ui', 'scanner', 'fs']

export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SCANNER_VIEWS.settings, bound(ctx, ScanSpecifiedDirsScreen))
  }, 'scanner-ui-desktop')
}

export default { name, inject, apply }
