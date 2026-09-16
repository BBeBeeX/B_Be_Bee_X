// @vitest-environment jsdom
/**
 * Desktop Settings Screen component tests.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { AppSettings, SettingsService, CacheClass, CacheStats } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { SettingsScreen } from './SettingsScreen.js'

afterEach(() => {
  cleanup()
})

async function harness(initialSettings: Partial<AppSettings> = {}) {
  let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...initialSettings }
  const calls: string[] = []

  class SettingsStub extends Service implements Partial<SettingsService> {
    private appCtx: Context

    constructor(ctx: Context) {
      super(ctx, 'settings')
      this.appCtx = ctx
    }

    get = async (): Promise<AppSettings> => {
      calls.push('get')
      return currentSettings
    }

    getSync = (): AppSettings => {
      return currentSettings
    }

    update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      calls.push(`update:${JSON.stringify(patch)}`)
      currentSettings = { ...currentSettings, ...patch }
      this.appCtx.emit('settings/changed', currentSettings)
      return currentSettings
    }

    reset = async (): Promise<AppSettings> => {
      calls.push('reset')
      currentSettings = { ...DEFAULT_APP_SETTINGS }
      this.appCtx.emit('settings/changed', currentSettings)
      return currentSettings
    }

    onSettingsChange = (callback: (settings: AppSettings) => void) => {
      return this.appCtx.on('settings/changed', callback)
    }
  }

  class CacheStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'cache')
    }

    stats = async (_className?: CacheClass): Promise<CacheStats> => {
      return {
        bytes: 5242880,
        entries: 10,
      }
    }

    clear = async (_className?: CacheClass): Promise<number> => {
      calls.push('clearCache')
      return 10
    }
  }

  class UiStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }

    navigate = (id: string) => {
      calls.push(`navigate:${id}`)
    }
  }

  const ctx = new Context()
  await ctx.plugin(SettingsStub)
  await ctx.plugin(CacheStub)
  await ctx.plugin(UiStub)

  return { ctx, calls, getCurrentSettings: () => currentSettings }
}

describe('SettingsScreen', () => {
  it('renders tabs and general settings by default', async () => {
    const { ctx } = await harness()
    const { getByText, findByText } = render(h(SettingsScreen, { ctx }))

    expect(await findByText('常规与外观')).toBeTruthy()
    expect(getByText('播放与音频')).toBeTruthy()
    expect(getByText('曲库与来源')).toBeTruthy()
    expect(getByText('存储与缓存')).toBeTruthy()
    expect(getByText('关于应用')).toBeTruthy()

    expect(getByText('外观主题')).toBeTruthy()
    expect(getByText('界面语言')).toBeTruthy()
    expect(getByText('关闭主窗口时最小化到系统托盘')).toBeTruthy()
  })

  it('switches to playback tab and toggles settings', async () => {
    const { ctx, calls } = await harness({ crossfadeEnabled: false })
    const { getByText, findByText } = render(h(SettingsScreen, { ctx }))

    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)

    expect(await findByText('曲目交叉淡入淡出 (Crossfade)')).toBeTruthy()
    expect(getByText('无缝播放 (Gapless Playback)')).toBeTruthy()
    expect(getByText('拔出音频设备时自动暂停')).toBeTruthy()

    // Find and click the toggle switch for crossfade
    const switches = document.querySelectorAll('button[role="switch"]')
    expect(switches.length).toBeGreaterThan(0)
    // The second switch is crossfade (first is gapless)
    const crossfadeSwitch = switches[1] ?? switches[0]
    if (crossfadeSwitch) {
      fireEvent.click(crossfadeSwitch)
    }

    await waitFor(() => {
      expect(calls.some((c) => c.startsWith('update:') && c.includes('crossfadeEnabled'))).toBe(true)
    })
  })

  it('switches to storage tab and clears cache', async () => {
    const { ctx, calls } = await harness()
    const { findByText } = render(h(SettingsScreen, { ctx }))

    const storageTab = await findByText('存储与缓存')
    fireEvent.click(storageTab)

    const clearButton = await findByText('清除全部缓存')
    fireEvent.click(clearButton)

    await waitFor(() => {
      expect(calls.includes('clearCache')).toBe(true)
    })
  })

  it('resets settings on reset button click', async () => {
    const { ctx, calls } = await harness({ theme: 'light' })
    const { findByText } = render(h(SettingsScreen, { ctx }))

    // Switch to about tab where reset button is located
    const aboutTab = await findByText('关于应用')
    fireEvent.click(aboutTab)

    const resetButton = await findByText('恢复默认设置')
    fireEvent.click(resetButton)

    const confirmButton = await findByText('确认重置')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(calls.includes('reset')).toBe(true)
    })
  })

  it('switches to about tab', async () => {
    const { ctx } = await harness()
    const { findByText, getByText } = render(h(SettingsScreen, { ctx }))

    const aboutTab = await findByText('关于应用')
    fireEvent.click(aboutTab)

    expect(await findByText('跨平台插件化音乐播放器 · Version 0.1.0')).toBeTruthy()
    expect(getByText('微内核架构')).toBeTruthy()
  })
})
