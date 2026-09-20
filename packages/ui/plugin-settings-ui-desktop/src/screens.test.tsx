// @vitest-environment jsdom
/**
 * Desktop Settings Screen component tests.
 */

import { describe, expect, it, afterEach, vi } from 'vitest'
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
    public views = new Map<string, unknown>()
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }

    navigate = (id: string) => {
      calls.push(`navigate:${id}`)
    }

    viewFor = (id: string) => {
      return this.views.get(id)
    }

    registerView = (id: string, component: unknown) => {
      this.views.set(id, component)
      return () => {
        this.views.delete(id)
      }
    }
  }

  class DspStub extends Service {
    public chain = [
      { effectId: 'eq10', enabled: true, ordinal: 20 },
      { effectId: 'normalize', enabled: true, ordinal: 30 },
      { effectId: 'compressor', enabled: true, ordinal: 40 },
      { effectId: 'reverb', enabled: true, ordinal: 50 },
    ]
    public definitions = [
      { id: 'eq10', displayName: '10频段均衡器', defaultOrder: 20 },
      { id: 'normalize', displayName: '响度标准化', defaultOrder: 30 },
      { id: 'compressor', displayName: '动态压缩器', defaultOrder: 40 },
      { id: 'reverb', displayName: '空间混响', defaultOrder: 50 },
    ]
    public latencyMs = 2

    constructor(ctx: Context) {
      super(ctx, 'dsp')
    }

    setEnabled = async (id: string, on: boolean) => {
      calls.push(`dsp:setEnabled:${id}:${on}`)
    }

    applyPreset = async (id: string, name: string) => {
      calls.push(`dsp:applyPreset:${id}:${name}`)
    }

    setParam = async (id: string, name: string, value: unknown) => {
      calls.push(`dsp:setParam:${id}:${name}:${value}`)
    }

    getParams = () => ({})
  }

  const ctx = new Context()
  await ctx.plugin(SettingsStub)
  await ctx.plugin(CacheStub)
  await ctx.plugin(UiStub)
  await ctx.plugin(DspStub)

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
    const crossfadeSwitch =
      (document.querySelector('button[aria-label="曲目交叉淡入淡出"]') as HTMLButtonElement) ??
      document.querySelectorAll('button[role="switch"]')[2]
    expect(crossfadeSwitch).toBeTruthy()
    fireEvent.click(crossfadeSwitch)

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

  it('displays and modifies EQ, normalize, compressor, reverb in playback tab and switches to DSP tab', async () => {
    const { ctx, calls } = await harness()
    // Register mock DSP view
    ;(ctx.ui as any).registerView('settings.dsp', () => h('div', null, 'Mock DSP Screen Content'))

    const { findByText, getByText } = render(h(SettingsScreen, { ctx }))

    // Switch to playback tab
    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)

    expect(await findByText('音频效果与均衡器 (DSP)')).toBeTruthy()

    // 1. Check EQ
    expect(getByText('10 频段图示均衡器 (10-Band EQ)')).toBeTruthy()
    expect(getByText('均衡器预设风格')).toBeTruthy()
    const flatButton = getByText('原声')
    fireEvent.click(flatButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:eq10:原声 (Flat)'))).toBe(true)

    // 2. Check Normalize
    expect(getByText('音量响度标准化 (Normalization)')).toBeTruthy()
    expect(getByText('标准化目标响度预设')).toBeTruthy()
    const lufsButton = getByText('流媒体 (-14)')
    fireEvent.click(lufsButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:normalize:流媒体标准 (-14 LUFS)'))).toBe(true)

    // 3. Check Compressor
    expect(getByText('动态范围压缩器 (Compressor)')).toBeTruthy()
    expect(getByText('压缩模式风格')).toBeTruthy()
    const nightButton = getByText('🌙 夜间模式')
    fireEvent.click(nightButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:compressor:夜间模式 (Night Mode)'))).toBe(true)

    // 4. Check Reverb
    expect(getByText('空间混响效果 (Reverb)')).toBeTruthy()
    expect(getByText('混响空间类型')).toBeTruthy()
    const hallButton = getByText('音乐大厅')
    fireEvent.click(hallButton)
    expect(calls.some((c) => c.includes('dsp:applyPreset:reverb:音乐大厅 (Concert Hall)'))).toBe(true)

    // 5. Switch to DSP tab
    const dspTab = await findByText('音效均衡器')
    fireEvent.click(dspTab)

    expect(await findByText('Mock DSP Screen Content')).toBeTruthy()
  })

  it('renders all sections simultaneously in the DOM with no icons in tabs', async () => {
    const { ctx } = await harness()
    const { container } = render(h(SettingsScreen, { ctx }))

    // All section anchors exist concurrently in DOM
    const sectionIds = [
      'section-general',
      'section-playback',
      'section-dsp',
      'section-sources',
      'section-storage',
      'section-about',
    ]
    for (const id of sectionIds) {
      expect(container.querySelector(`#${id}`)).toBeTruthy()
    }

    // Tab buttons have no emoji / icons
    const tabButtons = container.querySelectorAll('aside button[role="tab"]')
    expect(tabButtons.length).toBe(6)
    for (const btn of Array.from(tabButtons)) {
      expect(btn.querySelector('svg')).toBeNull()
      expect(btn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u)
    }
  })

  it('updates theme and language via Select dropdowns', async () => {
    const { ctx, calls } = await harness({ theme: 'dark', language: 'zh' })
    const { container } = render(h(SettingsScreen, { ctx }))

    // Theme select
    const themeSelect = container.querySelector('select[aria-label="外观主题"]') as HTMLSelectElement
    expect(themeSelect).toBeTruthy()
    expect(themeSelect.value).toBe('dark')
    fireEvent.change(themeSelect, { target: { value: 'light' } })
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"theme":"light"'))).toBe(true)
    })

    // Language select
    const langSelect = container.querySelector('select[aria-label="界面语言"]') as HTMLSelectElement
    expect(langSelect).toBeTruthy()
    expect(langSelect.value).toBe('zh')
    fireEvent.change(langSelect, { target: { value: 'en' } })
    await waitFor(() => {
      expect(calls.some((c) => c.includes('"language":"en"'))).toBe(true)
    })
  })

  it('navigates to section via tab scrollIntoView', async () => {
    const { ctx } = await harness()
    const { container, findByText } = render(h(SettingsScreen, { ctx }))

    const playbackSection = container.querySelector('#section-playback') as HTMLElement
    expect(playbackSection).toBeTruthy()
    const scrollMock = vi.fn()
    playbackSection.scrollIntoView = scrollMock

    const playbackTab = await findByText('播放与音频')
    fireEvent.click(playbackTab)

    expect(scrollMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('toggles expandable row via chevron button', async () => {
    const { ctx } = await harness({ crossfadeEnabled: true })
    const { container } = render(h(SettingsScreen, { ctx }))

    // Initially expanded when crossfadeEnabled: true
    expect(container.textContent).toContain('淡入淡出持续时间')

    // Find the chevron toggle button for crossfade
    const chevronBtn = container.querySelector('button[aria-label^="收起 曲目交叉淡入淡出"]') as HTMLButtonElement
    expect(chevronBtn).toBeTruthy()
    fireEvent.click(chevronBtn)

    // Now collapsed
    expect(container.textContent).not.toContain('淡入淡出持续时间')

    // Click again to re-expand
    const expandBtn = container.querySelector('button[aria-label^="展开 曲目交叉淡入淡出"]') as HTMLButtonElement
    expect(expandBtn).toBeTruthy()
    fireEvent.click(expandBtn)
    expect(container.textContent).toContain('淡入淡出持续时间')
  })
})
