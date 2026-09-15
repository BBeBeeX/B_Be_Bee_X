/**
 * React Native views for `plugin-download`.
 *
 * Same hooks, same state → controls map as the desktop twin — only the
 * elements differ. A single column instead of a pane, and actions wrap rather
 * than sitting on one line, because a phone is narrower than the row.
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
import { Button, EmptyState, IconButton, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { formatBytes } from '@BBeBee/toolkit'

const p = () => palettes.dark

export function DownloadsScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
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
    native.View as never,
    {
      style: {
        flex: 1,
        backgroundColor: p().bg.base,
        padding: tokens.space[4],
        gap: tokens.space[4],
      },
    },
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
      h(Text, { variant: 'lg' }, 'Downloads'),
      h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, summaryLine(summary)),
      clearable.length > 0
        ? h(Button, {
            variant: 'secondary',
            onPress: () => void ctx.downloads.clearFinished(),
            testID: 'downloads-clear',
            children: 'Clear',
          })
        : null,
    ),
    // The policy applies to the queue the moment it is flipped — a held task
    // starts, or a running one is paused with its bytes kept.
    h(
      native.View as never,
      {
        accessibilityRole: 'group',
        accessibilityLabel: 'Download network policy',
        style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] },
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
          icon: '⬇',
          title: 'No downloads',
          description:
            'A remote track is kept here after it plays once, so the next play needs no network.',
        })
      : null,
    active.length > 0 ? h(DownloadSection, { ctx, title: 'In progress', tasks: active }) : null,
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
  const native = nativePrimitives()
  const scheme = p()
  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: label,
      accessibilityState: { selected: active },
      testID,
      onPress,
      style: {
        minHeight: 30,
        paddingHorizontal: tokens.space[3],
        borderRadius: tokens.radius.pill,
        borderWidth: 1,
        borderColor: active ? 'transparent' : scheme.border.subtle,
        backgroundColor: active ? scheme.accent.base : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    h(
      native.Text as never,
      {
        style: {
          color: active ? scheme.accent.on : scheme.text.secondary,
          fontSize: tokens.font.size.xs,
          fontWeight: tokens.font.weight.bold,
        },
      },
      label,
    ),
  )
}

function summaryLine(summary: ReturnType<typeof summariseDownloads>): string {
  const parts: string[] = []
  if (summary.active) parts.push(`${summary.active} in progress`)
  if (summary.done) parts.push(`${summary.done} · ${formatBytes(summary.bytes)}`)
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
  const native = nativePrimitives()
  return h(
    native.View as never,
    { accessibilityLabel: title, style: { gap: tokens.space[2] } },
    h(Text, { variant: 'md', tone: 'muted' }, title),
    ...tasks.map((task) => h(DownloadRow, { key: task.id, ctx, task })),
  )
}

function DownloadRow({ ctx, task }: { ctx: Context; task: DownloadTask }): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  const progress = downloadProgress(task)
  const player = serviceOf<PlayerService>(ctx, 'player')

  return h(
    native.View as never,
    {
      testID: `download-${task.id}`,
      style: {
        padding: tokens.space[3],
        borderRadius: tokens.radius.sm,
        backgroundColor: scheme.bg.raised,
        gap: tokens.space[2],
      },
    },
    h(
      native.View as never,
      { style: { gap: 2 } },
      h(Text, { numberOfLines: 1 }, task.title),
      task.artist ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, task.artist) : null,
      h(
        Text,
        { variant: 'xs', tone: task.state === 'failed' ? 'error' : 'muted', numberOfLines: 2 },
        statusLine(task),
      ),
      progress !== undefined
        ? h(ProgressBar, { value: progress, label: `Progress for ${task.title}` })
        : null,
    ),
    h(
      native.View as never,
      { style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: tokens.space[2] } },
      ...actionsFor(ctx, task, player),
    ),
  )
}

/**
 * What one task can do next. See the desktop twin: the state decides, because
 * offering "Resume" on a running task is an affordance that lies.
 */
function actionsFor(
  ctx: Context,
  task: DownloadTask,
  player: PlayerService | undefined,
): ReactElement[] {
  const actions: ReactElement[] = []

  if (task.state === 'done') {
    return [
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
        icon: '🗑',
        accessibilityLabel: `Delete ${task.title}`,
        onPress: () => void ctx.downloads.remove(task.id),
        testID: `download-remove-${task.id}`,
      }),
    ]
  }

  if (task.state === 'failed' || task.state === 'canceled') {
    return [
      h(Button, {
        key: 'retry',
        variant: 'secondary',
        onPress: () => void ctx.downloads.retry(task.id),
        testID: `download-retry-${task.id}`,
        children: 'Retry',
      }),
      h(IconButton, {
        key: 'remove',
        icon: '🗑',
        accessibilityLabel: `Delete ${task.title}`,
        onPress: () => void ctx.downloads.remove(task.id),
        testID: `download-remove-${task.id}`,
      }),
    ]
  }

  actions.push(
    task.state === 'paused'
      ? h(Button, {
          key: 'resume',
          variant: 'secondary',
          onPress: () => void ctx.downloads.resume(task.id),
          testID: `download-resume-${task.id}`,
          children: 'Resume',
        })
      : h(Button, {
          key: 'pause',
          variant: 'ghost',
          onPress: () => void ctx.downloads.pause(task.id),
          testID: `download-pause-${task.id}`,
          children: 'Pause',
        }),
  )
  actions.push(
    h(IconButton, {
      key: 'cancel',
      icon: '✕',
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
      return task.kept ? 'Downloaded' : 'Cached'
    case 'failed':
      return task.error ?? 'Failed'
    case 'canceled':
      return 'Canceled'
  }
}

/** A read-only bar. Not a `Slider`: that is a control a user can grab. */
function ProgressBar({ value, label }: { value: number; label: string }): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  const percent = Math.round(value * 100)
  return h(
    native.View as never,
    {
      accessibilityLabel: label,
      accessibilityValue: { min: 0, max: 100, now: percent },
      style: {
        height: 4,
        width: '100%',
        borderRadius: 2,
        backgroundColor: scheme.border.subtle,
        overflow: 'hidden',
      },
    },
    h(native.View as never, {
      style: {
        width: `${percent}%`,
        height: '100%',
        backgroundColor: scheme.accent.base,
      },
    }),
  )
}

export const name = 'plugin-download-ui-mobile'

/**
 * Bind a screen to *this* plugin's context, not the shell's. See the desktop
 * twin for the device bug this prevents.
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
  return ctx.effect(function* () {
    yield ctx.ui.registerView(DOWNLOADS_VIEWS.page, bound(ctx, DownloadsScreen))
  }, 'downloads-ui-mobile')
}

export default { name, inject, apply }
