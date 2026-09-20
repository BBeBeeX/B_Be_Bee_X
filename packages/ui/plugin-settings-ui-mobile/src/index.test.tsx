// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { Context, Service } from '@BBeBee/kernel'
import type { AppSettings, SettingsService, CacheClass, CacheStats, DspService, ChainEntry } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import pluginSettingsUi, { SettingsScreen } from './index.js'

afterEach(cleanup)

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (onPress as () => void) : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: hostComponent('FlashList'),
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

class UiStub extends Service {
  public views = new Map<string, unknown>()
  public routes: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: unknown) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  navigate(id: string) {
    this.routes.push(id)
  }

  viewFor(id: string) {
    return this.views.get(id)
  }
}

class SettingsStub extends Service implements Partial<SettingsService> {
  private appCtx: Context
  public currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }

  constructor(ctx: Context) {
    super(ctx, 'settings')
    this.appCtx = ctx
  }

  get = async (): Promise<AppSettings> => {
    return this.currentSettings
  }

  getSync = (): AppSettings => {
    return this.currentSettings
  }

  update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    this.currentSettings = { ...this.currentSettings, ...patch }
    this.appCtx.emit('settings/changed', this.currentSettings)
    return this.currentSettings
  }

  reset = async (): Promise<AppSettings> => {
    this.currentSettings = { ...DEFAULT_APP_SETTINGS }
    this.appCtx.emit('settings/changed', this.currentSettings)
    return this.currentSettings
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
    return { bytes: 1024, entries: 1 }
  }

  clear = async (): Promise<number> => 1
}

class DspStub extends Service implements Partial<DspService> {
  public chain: readonly ChainEntry[] = [
    { effectId: 'eq10', enabled: true, ordinal: 20 },
    { effectId: 'compressor', enabled: false, ordinal: 30 },
    { effectId: 'widener', enabled: false, ordinal: 40 },
  ]
  public definitions = [
    { id: 'eq10', displayName: '10频段均衡器', defaultOrder: 20 },
  ]
  public latencyMs = 2

  constructor(ctx: Context) {
    super(ctx, 'dsp')
  }

  setEnabled = async (id: string, on: boolean) => {
    this.chain = this.chain.map((c) => (c.effectId === id ? { ...c, enabled: on } : c))
  }

  applyPreset = async () => {}
  getParams = () => ({})
}

async function createHarness() {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await ctx.plugin(SettingsStub)
  await ctx.plugin(CacheStub)
  await ctx.plugin(DspStub)
  await ctx.plugin(pluginSettingsUi)
  return { ctx }
}

describe('plugin-settings-ui-mobile', () => {
  it('registers settings view with ui service', async () => {
    const { ctx } = await createHarness()
    expect((ctx.ui as any).viewFor('settings.view')).toBeDefined()
  })

  it('renders mobile SettingsScreen with DSP section and controls', async () => {
    const { ctx } = await createHarness()
    const { container } = render(h(SettingsScreen, { ctx }))

    expect(container.textContent).toContain('设置')
    expect(container.textContent).toContain('外观与语言')
    expect(container.textContent).toContain('播放与音频')
    expect(container.textContent).toContain('音频效果与均衡器 (DSP)')
    expect(container.textContent).toContain('10 频段均衡器 (EQ)')
    expect(container.textContent).toContain('夜间压缩模式')
    expect(container.textContent).toContain('立体声扩宽')
    expect(container.textContent).toContain('高级效果器调音')
  })
})
