/**
 * React DOM views for `plugin-download`.
 *
 * The download queue and what it has cached. Every value comes from
 * `@BBeBee/plugin-download/hooks` — the list, the header's numbers, one task's
 * completion — and this file is layout, gestures and event wiring only
 * (docs/08 §1).
 *
 * The one thing worth doing carefully here is the **state → controls** map.
 * A queued task can be paused but not resumed; a failed one can be retried but
 * not paused. Offering the wrong control is worse than offering none, so the
 * buttons follow the state rather than the other way round.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { DownloadTask, PlayerService } from '@BBeBee/protocol'
import { DOWNLOADS_VIEWS } from '@BBeBee/plugin-download/views'
import {
  downloadProgress,
  holdLabel,
  summariseDownloads,
  useDownloadPolicy,
  useDownloadTasks,
} from '@BBeBee/plugin-download/hooks'
import { Button, EmptyState, IconButton, Text } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { formatBytes } from '@BBeBee/toolkit'

const p = () => palettes.dark

export function DownloadsScreen({ ctx }: { ctx: Context }): ReactElement {
  const tasks = useDownloadTasks(ctx)
  const policy = useDownloadPolicy(ctx)
  const summary = summariseDownloads(tasks)

  const active = tasks.filter(
    (task) => task.state === 'queued' || task.state === 'running' || task.state === 'paused',
  )
  const finished = tasks.filter((task) => !active.includes(task))
  // Kept downloads are the user's files; only their own 🗑 deletes one, so the
  // header's clear button is offered for cache entries and dead tasks only.
  const clearable = finished.filter(
    (task) => task.state === 'canceled' || (task.state === 'done' && !task.kept),
  )

  return h(
    'section',
    {
      'aria-label': 'Downloads',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[4],
        padding: tokens.space[4],
      },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'baseline', gap: tokens.space[3] } },
      h(Text, { variant: 'lg' }, 'Downloads'),
      h(Text, { variant: 'sm', tone: 'muted' }, summaryLine(summary)),
      clearable.length > 0
        ? h(Button, {
            variant: 'secondary',
            onPress: () => void ctx.downloads.clearFinished(),
            testID: 'downloads-clear',
            children: 'Clear finished',
          })
        : null,
    ),
    // The policy applies to the queue the moment it is flipped — a held task
    // starts, or a running one is paused with its bytes kept.
    h(
      'div',
      {
        role: 'group',
        'aria-label': 'Download network policy',
        style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] },
      },
      h(PolicyToggle, {
        label: 'Wi-Fi only',
        active: policy.wifiOnly,
        onPress: () => void ctx.downloads.setPolicy({ wifiOnly: !policy.wifiOnly }),
        testID: 'downloads-wifi-only',
      }),
      h(PolicyToggle, {
        label: 'Charging only',
        active: policy.chargingOnly,
        onPress: () => void ctx.downloads.setPolicy({ chargingOnly: !policy.chargingOnly }),
        testID: 'downloads-charging-only',
      }),
    ),
    tasks.length === 0
      ? h(EmptyState, {
          icon: 'download',
          title: 'No downloads',
          description:
            'A remote track is kept here after it plays once, so the next play needs no network. Tracks you download explicitly are saved and never evicted; cached ones are.',
        })
      : null,
    active.length > 0
      ? h(DownloadSection, { ctx, title: 'In progress', tasks: active })
      : null,
    finished.length > 0
      ? h(DownloadSection, { ctx, title: 'Downloaded', tasks: finished })
      : null,
  )
}

/** A filter-sized toggle for the two policy switches. */
function PolicyToggle({
  label,
  active,
  onPress,
  testID,
}: {
  label: string
  active: boolean
  onPress: () => void
  testID: string
}): ReactElement {
  const scheme = p()
  return h(
    'button',
    {
      type: 'button',
      onClick: onPress,
      'aria-pressed': active,
      'data-testid': testID,
      style: {
        minHeight: 26,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.pill,
        border: `1px solid ${active ? 'transparent' : scheme.border.subtle}`,
        background: active ? scheme.accent.base : 'transparent',
        color: active ? scheme.accent.on : scheme.text.secondary,
        fontFamily: tokens.font.family.ui,
        fontSize: tokens.font.size.xs,
        fontWeight: tokens.font.weight.bold,
        cursor: 'pointer',
      },
    },
    label,
  )
}

function summaryLine(summary: ReturnType<typeof summariseDownloads>): string {
  const parts: string[] = []
  if (summary.active) parts.push(`${summary.active} in progress`)
  if (summary.done) parts.push(`${summary.done} downloaded · ${formatBytes(summary.bytes)}`)
  if (summary.failed) parts.push(`${summary.failed} failed`)
  return parts.length > 0 ? parts.join(' · ') : 'Nothing yet'
}

function DownloadSection({
  ctx,
  title,
  tasks,
}: {
  ctx: Context
  title: string
  tasks: readonly DownloadTask[]
}): ReactElement {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
    h(Text, { variant: 'md', tone: 'muted' }, title),
    h(
      'ul',
      {
        'aria-label': title,
        style: {
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[1],
        },
      },
      ...tasks.map((task) => h(DownloadRow, { key: task.id, ctx, task })),
    ),
  )
}

function DownloadRow({ ctx, task }: { ctx: Context; task: DownloadTask }): ReactElement {
  const scheme = p()
  const progress = downloadProgress(task)
  const player = serviceOf<PlayerService>(ctx, 'player')

  return h(
    'li',
    {
      'data-testid': `download-${task.id}`,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        padding: tokens.space[3],
        borderRadius: tokens.radius.sm,
        background: scheme.bg.raised,
      },
    },
    h(
      'div',
      { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
      h(Text, { numberOfLines: 1 }, task.title),
      task.artist ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, task.artist) : null,
      h(
        Text,
        {
          variant: 'xs',
          tone: task.state === 'failed' ? 'error' : 'muted',
          numberOfLines: 1,
        },
        statusLine(task),
      ),
      progress !== undefined
        ? h(ProgressBar, { value: progress, label: `Progress for ${task.title}` })
        : null,
    ),
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2], flexShrink: 0 } },
      ...actionsFor(ctx, task, player),
    ),
  )
}

/**
 * What one task can do next.
 *
 * Derived from the state rather than from capabilities, because every task is
 * owned by this service: `done` offers play and delete, `failed` offers retry
 * and delete, and the four moving states split on whether they are currently
 * transferring.
 */
function actionsFor(
  ctx: Context,
  task: DownloadTask,
  player: PlayerService | undefined,
): ReactElement[] {
  const actions: ReactElement[] = []

  if (task.state === 'done') {
    actions.push(
      h(Button, {
        key: 'play',
        variant: 'secondary',
        onPress: () => void player?.playNow([task.trackUrn]),
        disabled: !player,
        testID: `download-play-${task.id}`,
        children: 'Play',
      }),
      h(IconButton, {
        key: 'remove',
        icon: 'trash',
        accessibilityLabel: `Delete ${task.title}`,
        onPress: () => void ctx.downloads.remove(task.id),
        testID: `download-remove-${task.id}`,
      }),
    )
    return actions
  }

  if (task.state === 'failed' || task.state === 'canceled') {
    actions.push(
      h(Button, {
        key: 'retry',
        variant: 'secondary',
        onPress: () => void ctx.downloads.retry(task.id),
        testID: `download-retry-${task.id}`,
        children: 'Retry',
      }),
      h(IconButton, {
        key: 'remove',
        icon: 'trash',
        accessibilityLabel: `Delete ${task.title}`,
        onPress: () => void ctx.downloads.remove(task.id),
        testID: `download-remove-${task.id}`,
      }),
    )
    return actions
  }

  if (task.state === 'paused') {
    actions.push(
      h(Button, {
        key: 'resume',
        variant: 'secondary',
        onPress: () => void ctx.downloads.resume(task.id),
        testID: `download-resume-${task.id}`,
        children: 'Resume',
      }),
    )
  } else {
    actions.push(
      h(Button, {
        key: 'pause',
        variant: 'ghost',
        onPress: () => void ctx.downloads.pause(task.id),
        testID: `download-pause-${task.id}`,
        children: 'Pause',
      }),
    )
  }

  actions.push(
    h(IconButton, {
      key: 'cancel',
      icon: 'x',
      accessibilityLabel: `Cancel ${task.title}`,
      onPress: () => void ctx.downloads.cancel(task.id),
      testID: `download-cancel-${task.id}`,
    }),
  )
  return actions
}

/** One line saying where a task is, in the user's terms. */
function statusLine(task: DownloadTask): string {
  const hold = holdLabel(task)
  if (hold) return task.state === 'paused' ? `Paused — ${hold.toLowerCase()}` : hold
  switch (task.state) {
    case 'queued':
      return 'Queued'
    case 'running':
      return task.bytesTotal
        ? `${formatBytes(task.bytesDone)} of ${formatBytes(task.bytesTotal)}`
        : formatBytes(task.bytesDone)
    case 'paused':
      return `Paused · ${formatBytes(task.bytesDone)}`
    case 'done':
      // A kept download is the user's to keep; a cache entry is evictable.
      return task.kept
        ? task.quality
          ? `Downloaded · ${task.quality}`
          : 'Downloaded'
        : 'Cached'
    case 'failed':
      return task.error ?? 'Failed'
    case 'canceled':
      return 'Canceled'
  }
}

/**
 * A read-only bar.
 *
 * Not a `Slider`: that is a control, and a control a user can grab but that
 * does nothing is exactly the affordance mismatch the actions map above
 * avoids.
 */
function ProgressBar({ value, label }: { value: number; label: string }): ReactElement {
  const scheme = p()
  const percent = Math.round(value * 100)
  return h(
    'div',
    {
      role: 'progressbar',
      'aria-label': label,
      'aria-valuenow': percent,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      style: {
        height: 3,
        width: '100%',
        borderRadius: 1.5,
        background: scheme.border.subtle,
        overflow: 'hidden',
      },
    },
    h('div', {
      style: {
        width: `${percent}%`,
        height: '100%',
        background: scheme.accent.base,
        transition: `width ${tokens.duration.fast}ms linear`,
      },
    }),
  )
}

export const name = 'plugin-download-ui-desktop'

/**
 * Bind a screen to *this* plugin's context, not the shell's.
 *
 * ⚠️ The shell renders a view as `h(Component, { ctx })` with **its own**
 * context — the one it got from `app.ready(['ui'])`, which has `ui` injected
 * and nothing else. A cordis context throws for any property that was not
 * injected, so a screen reading `ctx.downloads` through its hooks threw on a
 * device while every test passed, because tests built a root context where
 * that read answers `undefined` instead. See the note in every view package.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export const inject = ['ui', 'downloads']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-download-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(DOWNLOADS_VIEWS.page, bound(ctx, DownloadsScreen))
  }, 'downloads-ui-desktop')
}

export default { name, inject, apply }
