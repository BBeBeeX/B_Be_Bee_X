import type { MenuItemSpec, SubmenuSpec } from '@BBeBee/ui-core'
import type { SleepTimerService } from '@BBeBee/protocol'

/**
 * "Sleep Timer" submenu: 5min, 10min, 15min, 30min, 45min, 1h, end of track,
 * and a custom minutes input via `create`.
 */
export function sleepTimerSubmenu(
  sleepTimer: SleepTimerService | undefined,
): SubmenuSpec | undefined {
  if (!sleepTimer) return undefined
  const items: MenuItemSpec[] = []

  if (sleepTimer.state.active) {
    items.push({
      id: 'timer-cancel',
      label: '关闭睡眠定时器',
      icon: 'x',
      tone: 'danger',
      onSelect: () => sleepTimer.cancel(),
    })
  }

  items.push(
    {
      id: 'timer-5m',
      label: '5 分钟',
      onSelect: () => sleepTimer.startDuration(5 * 60 * 1000),
    },
    {
      id: 'timer-10m',
      label: '10 分钟',
      onSelect: () => sleepTimer.startDuration(10 * 60 * 1000),
    },
    {
      id: 'timer-15m',
      label: '15 分钟',
      onSelect: () => sleepTimer.startDuration(15 * 60 * 1000),
    },
    {
      id: 'timer-30m',
      label: '30 分钟',
      onSelect: () => sleepTimer.startDuration(30 * 60 * 1000),
    },
    {
      id: 'timer-45m',
      label: '45 分钟',
      onSelect: () => sleepTimer.startDuration(45 * 60 * 1000),
    },
    {
      id: 'timer-1h',
      label: '1 小时',
      onSelect: () => sleepTimer.startDuration(60 * 60 * 1000),
    },
    {
      id: 'timer-end-of-track',
      label: '曲目结束时',
      onSelect: () => sleepTimer.startEndOfTrack(),
    },
  )

  return {
    title: '睡眠定时器',
    create: {
      label: '自定义时间',
      placeholder: '自定义时间 (单位: 分钟)',
      alwaysVisible: true,
      placement: 'bottom',
      buttonLabel: '确定',
      onSelect: (val: string) => {
        const trimmed = val.trim()
        const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]!, 10)
          const minutes = parseInt(timeMatch[2]!, 10)
          const target = new Date()
          target.setHours(hours, minutes, 0, 0)
          if (target.getTime() <= Date.now()) {
            target.setDate(target.getDate() + 1)
          }
          sleepTimer.startAtEpoch(target.getTime())
          return
        }

        const mins = parseFloat(trimmed)
        if (Number.isFinite(mins) && mins > 0) {
          sleepTimer.startDuration(mins * 60 * 1000)
        }
      },
    },
    items,
  }
}
