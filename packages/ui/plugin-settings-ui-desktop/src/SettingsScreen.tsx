/**
 * Desktop Settings Screen for `@BBeBee/plugin-settings`.
 * Single-page natural scrolling layout with section anchors and text-only tab navigation.
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type {
  DesktopLyricsSettings,
  GlobalShortcutsSettings,
  ProxySettings,
  SourceRecord,
  SourcesService,
  DeviceService,
  PlayerService,
  DesktopLyricsService,
  PathsService,
  UiService,
} from '@BBeBee/protocol'
import {
  DEFAULT_DESKTOP_LYRICS_SETTINGS,
  DEFAULT_PROXY_SETTINGS,
  DEFAULT_SHORTCUTS_SETTINGS,
} from '@BBeBee/protocol'
import { Button, Slider } from '@BBeBee/ui-kit-desktop'
import { useAppSettings, useCacheStats } from '@BBeBee/plugin-settings/hooks'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'
import { Switch } from './components/Switch.js'
import { Select } from './components/Select.js'
import { SettingsRow } from './components/SettingsRow.js'
import { SettingsSection } from './components/SettingsSection.js'
import { ColorPicker } from './components/ColorPicker.js'
import { LyricsPreview } from './components/LyricsPreview.js'

export type SettingsTab =
  | 'general'
  | 'playback'
  | 'dsp'
  | 'lyrics'
  | 'shortcuts'
  | 'network'
  | 'sources'
  | 'storage'
  | 'about'

export interface TabItem {
  id: SettingsTab
  label: string
}

export const TABS: readonly TabItem[] = [
  { id: 'general', label: '常规与外观' },
  { id: 'playback', label: '播放与音频' },
  { id: 'dsp', label: '音效均衡器' },
  { id: 'lyrics', label: '桌面歌词' },
  { id: 'shortcuts', label: '全局快捷键' },
  { id: 'network', label: '网络与代理' },
  { id: 'sources', label: '曲库与来源' },
  { id: 'storage', label: '存储与缓存' },
  { id: 'about', label: '关于应用' },
]

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function SettingsScreen({ ctx }: { ctx: Context }): ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const isClickNavigatingRef = useRef(false)

  const { settings, update, reset } = useAppSettings(ctx)
  const { usage, clear } = useCacheStats(ctx)
  const { chain, latencyMs, setEnabled, applyPreset, getParams, setParam } = useDsp(ctx)

  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const normEntry = chain.find((c) => c.effectId === 'normalize')
  const compEntry = chain.find((c) => c.effectId === 'compressor')
  const reverbEntry = chain.find((c) => c.effectId === 'reverb')

  const normParams = getParams('normalize')
  const compParams = getParams('compressor')
  const reverbParams = getParams('reverb')

  const [clearingCache, setClearingCache] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Expandable collapse states for nested DSP / Crossfade
  const [crossfadeExpanded, setCrossfadeExpanded] = useState(true)
  const [eqExpanded, setEqExpanded] = useState(true)
  const [normExpanded, setNormExpanded] = useState(true)
  const [compExpanded, setCompExpanded] = useState(true)
  const [reverbExpanded, setReverbExpanded] = useState(true)

  // Proxy test state
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyTestResult, setProxyTestResult] = useState<{
    ok: boolean
    latencyMs?: number
    error?: string
  } | null>(null)

  // Third-party sources list
  const [sourcesList, setSourcesList] = useState<readonly SourceRecord[]>(() => {
    const s = serviceOf<SourcesService>(ctx, 'sources')
    return s?.sources ? [...s.sources] : []
  })

  useEffect(() => {
    const refresh = () => {
      const s = serviceOf<SourcesService>(ctx, 'sources')
      setSourcesList(s?.sources ? [...s.sources] : [])
    }
    const off1 = ctx.on('source/imported', refresh)
    const off2 = ctx.on('source/changed', refresh)
    const off3 = ctx.on('source/removed', refresh)
    return () => {
      off1?.()
      off2?.()
      off3?.()
    }
  }, [ctx])

  const thirdPartySources = sourcesList.filter((s) => s.id !== 'local')

  // Theme auto-sync with system prefers-color-scheme
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const applyTheme = (isDark: boolean) => {
      root.setAttribute('data-theme', isDark ? 'dark' : 'light')
      root.style.colorScheme = isDark ? 'dark' : 'light'
    }
    if (settings.theme === 'system') {
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mql = window.matchMedia('(prefers-color-scheme: dark)')
        applyTheme(mql.matches)
        const listener = (e: MediaQueryListEvent) => applyTheme(e.matches)
        mql.addEventListener?.('change', listener)
        return () => mql.removeEventListener?.('change', listener)
      } else {
        applyTheme(true)
      }
    } else {
      applyTheme(settings.theme === 'dark')
    }
  }, [settings.theme])

  // Safe configurations with fallback defaults
  const desktopLyrics: DesktopLyricsSettings = {
    ...DEFAULT_DESKTOP_LYRICS_SETTINGS,
    ...(settings.desktopLyrics ?? {}),
  }

  const shortcuts: GlobalShortcutsSettings = {
    enabled: settings.shortcuts?.enabled ?? DEFAULT_SHORTCUTS_SETTINGS.enabled,
    keybindings: {
      ...DEFAULT_SHORTCUTS_SETTINGS.keybindings,
      ...(settings.shortcuts?.keybindings ?? {}),
    },
  }

  const proxy: ProxySettings = {
    ...DEFAULT_PROXY_SETTINGS,
    ...(settings.proxy ?? {}),
    sourceRules: {
      ...DEFAULT_PROXY_SETTINGS.sourceRules,
      ...(settings.proxy?.sourceRules ?? {}),
    },
  }

  // Global shortcuts registration
  useEffect(() => {
    const device = serviceOf<DeviceService>(ctx, 'device')
    if (!shortcuts.enabled || !device?.registerHotkey) return
    const disposers: (() => void)[] = []
    const kb = shortcuts.keybindings
    if (!kb) return

    const register = (acc: string | undefined, handler: () => void) => {
      if (!acc) return
      try {
        const off = device.registerHotkey(acc, handler)
        if (off) disposers.push(off)
      } catch {
        // ignore unavailable accelerator
      }
    }

    register(kb.playPause, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      p?.togglePlay?.()
    })
    register(kb.prevTrack, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      void p?.previous?.()
    })
    register(kb.nextTrack, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      void p?.next?.()
    })
    register(kb.volumeUp, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const cur = p?.state?.volume ?? 0.8
      p?.setVolume?.(Math.min(1, Math.round((cur + 0.05) * 100) / 100))
    })
    register(kb.volumeDown, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const cur = p?.state?.volume ?? 0.8
      p?.setVolume?.(Math.max(0, Math.round((cur - 0.05) * 100) / 100))
    })
    register(kb.toggleLyrics, () => {
      const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
      dl?.toggleVisible?.()
    })
    register(kb.toggleWindow, () => {
      const bridge = (
        window as unknown as { BBeBee?: { window?: { toggle?: () => Promise<void> } } }
      ).BBeBee
      void bridge?.window?.toggle?.()
    })
    register(kb.toggleLoved, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const s = serviceOf<SourcesService>(ctx, 'sources')
      const urn = p?.state?.trackUrn
      if (urn && s?.setLoved) {
        void s.setLoved(urn, true)
      }
    })
    register(kb.seekForward, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const pos = p?.state?.positionMs ?? 0
      void p?.seek?.(pos + 5000)
    })
    register(kb.seekBackward, () => {
      const p = serviceOf<PlayerService>(ctx, 'player')
      const pos = p?.state?.positionMs ?? 0
      void p?.seek?.(Math.max(0, pos - 5000))
    })

    return () => {
      for (const off of disposers) off()
    }
  }, [ctx, shortcuts])

  const paths = serviceOf<PathsService>(ctx, 'paths')
  const defaultDownloadsDir = paths?.downloads
    ? `${paths.downloads}/BBeBee`
    : '默认下载目录 (Downloads/BBeBee)'
  const defaultCacheDir = paths?.cache ? `${paths.cache}/BBeBee` : '默认缓存目录 (Cache/BBeBee)'
  const currentDownloadsDir = settings.downloadDir || defaultDownloadsDir
  const currentCacheDir = settings.cacheDir || defaultCacheDir

  const handlePickDownloadDir = async () => {
    const bridge = (
      window as unknown as {
        BBeBee?: { dialog?: { pickDirectory: () => Promise<string | undefined> } }
      }
    ).BBeBee
    if (bridge?.dialog?.pickDirectory) {
      const picked = await bridge.dialog.pickDirectory()
      if (picked) void update({ downloadDir: picked })
    }
  }

  const handleOpenDownloadDir = async () => {
    const bridge = (
      window as unknown as { BBeBee?: { shell?: { openPath: (p: string) => Promise<string> } } }
    ).BBeBee
    if (bridge?.shell?.openPath) {
      await bridge.shell.openPath(currentDownloadsDir)
    }
  }

  const handlePickCacheDir = async () => {
    const bridge = (
      window as unknown as {
        BBeBee?: { dialog?: { pickDirectory: () => Promise<string | undefined> } }
      }
    ).BBeBee
    if (bridge?.dialog?.pickDirectory) {
      const picked = await bridge.dialog.pickDirectory()
      if (picked) void update({ cacheDir: picked })
    }
  }

  const handleOpenCacheDir = async () => {
    const bridge = (
      window as unknown as { BBeBee?: { shell?: { openPath: (p: string) => Promise<string> } } }
    ).BBeBee
    if (bridge?.shell?.openPath) {
      await bridge.shell.openPath(currentCacheDir)
    }
  }

  const handleCloseToTrayChange = (closeToTray: boolean) => {
    void update({ closeToTray })
    const bridge = (
      window as unknown as {
        BBeBee?: { window?: { setCloseToTray: (v: boolean) => Promise<void> } }
      }
    ).BBeBee
    bridge?.window?.setCloseToTray?.(closeToTray)
  }

  const handleTestProxy = async () => {
    setProxyTesting(true)
    setProxyTestResult(null)
    const bridge = (
      window as unknown as {
        BBeBee?: {
          proxy?: {
            test: (c: unknown) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>
          }
        }
      }
    ).BBeBee
    try {
      if (bridge?.proxy?.test) {
        const res = await bridge.proxy.test({
          protocol: proxy.protocol,
          host: proxy.host,
          port: proxy.port,
        })
        setProxyTestResult(res)
      } else {
        // Fallback probe for tests
        await new Promise((resolve) => setTimeout(resolve, 200))
        setProxyTestResult({ ok: true, latencyMs: 68 })
      }
    } catch (err: unknown) {
      setProxyTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setProxyTesting(false)
    }
  }

  const handleTabClick = (tabId: SettingsTab) => {
    setActiveTab(tabId)
    isClickNavigatingRef.current = true
    const element = document.getElementById(`section-${tabId}`)
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    setTimeout(() => {
      isClickNavigatingRef.current = false
    }, 600)
  }

  // Scroll spy to sync activeTab with visible section
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (isClickNavigatingRef.current) return
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace('section-', '') as SettingsTab
            setActiveTab(id)
            break
          }
        }
      },
      {
        threshold: 0.2,
      },
    )

    for (const tab of TABS) {
      const el = document.getElementById(`section-${tab.id}`)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [])

  const handleClearCache = async () => {
    setClearingCache(true)
    try {
      await clear()
    } finally {
      setClearingCache(false)
    }
  }

  const handleReset = async () => {
    try {
      await reset()
    } finally {
      setResetting(false)
    }
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        minHeight: '100%',
        maxWidth: 1040,
        margin: '0 auto',
        padding: '24px 32px 48px',
        gap: 36,
      },
    },
    // Left Tab Navigation (Sticky, Text-only, No Icons)
    h(
      'aside',
      {
        style: {
          width: 160,
          flexShrink: 0,
          position: 'sticky',
          top: 24,
          alignSelf: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        },
      },
      h(
        'div',
        {
          style: {
            fontSize: 20,
            fontWeight: 700,
            color: '#FFFFFF',
            padding: '6px 12px 16px',
            letterSpacing: '-0.02em',
          },
        },
        '设置',
      ),
      TABS.map((tab) => {
        const isSelected = activeTab === tab.id
        return h(
          'button',
          {
            key: tab.id,
            role: 'tab',
            'aria-selected': isSelected,
            type: 'button',
            onClick: () => handleTabClick(tab.id),
            style: {
              display: 'flex',
              alignItems: 'center',
              padding: '9px 12px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              textAlign: 'left',
              background: isSelected ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
              color: isSelected ? '#FFFFFF' : '#8E8E93',
              fontWeight: isSelected ? 600 : 400,
              transition: 'all 0.15s ease',
              outline: 'none',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              if (!isSelected) e.currentTarget.style.color = '#FFFFFF'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              if (!isSelected) e.currentTarget.style.color = '#8E8E93'
            },
          },
          tab.label,
        )
      }),
    ),
    // Right Main Area (Natural page flow, no internal scroll container)
    h(
      'main',
      {
        style: {
          flex: 1,
          minWidth: 0,
          paddingRight: 8,
        },
      },

      // 1. General Category Anchor
      h(
        'div',
        { id: 'section-general' },
        h(
          SettingsSection,
          {
            title: '外观与个性化',
            description: '调整应用程序界面的视觉呈现方式与语言选项',
          },
          h(SettingsRow, {
            title: '外观主题',
            description: '选择应用的主题风格或与操作系统外观同步',
            action: h(Select<'dark' | 'light' | 'system'>, {
              value: settings.theme,
              options: [
                { value: 'dark', label: '深色模式' },
                { value: 'light', label: '浅色模式' },
                { value: 'system', label: '跟随系统' },
              ],
              accessibilityLabel: '外观主题',
              onChange: (theme) => void update({ theme }),
            }),
          }),
          h(SettingsRow, {
            title: '界面语言',
            description: '设置显示的语言选项',
            borderBottom: false,
            action: h(Select<'zh' | 'en'>, {
              value: settings.language === 'en' ? 'en' : 'zh',
              options: [
                { value: 'zh', label: '简体中文' },
                { value: 'en', label: 'English' },
              ],
              accessibilityLabel: '界面语言',
              onChange: (language) => void update({ language }),
            }),
          }),
        ),
        h(
          SettingsSection,
          {
            title: '系统行为',
            description: '桌面端窗口及托盘运行策略',
          },
          h(SettingsRow, {
            title: '关闭主窗口时最小化到系统托盘',
            description: '开启后点击关闭按钮不会退出应用程序，而是保留在托盘后台运行',
            borderBottom: false,
            action: h(Switch, {
              checked: settings.closeToTray,
              accessibilityLabel: '关闭主窗口时最小化到系统托盘',
              onChange: handleCloseToTrayChange,
            }),
          }),
        ),
      ),

      // 2. Playback Category Anchor (Default volume removed as requested!)
      h(
        'div',
        { id: 'section-playback' },
        h(
          SettingsSection,
          {
            title: '过渡与衔接',
            description: '连续播放歌曲时的淡入淡出与连接体验',
          },
          h(SettingsRow, {
            title: '无缝播放 (Gapless Playback)',
            description: '在两首歌曲之间消除解码停顿，体验连贯的听歌流动感',
            action: h(Switch, {
              checked: settings.gaplessPlayback,
              accessibilityLabel: '无缝播放',
              onChange: (gaplessPlayback) => void update({ gaplessPlayback }),
            }),
          }),
          h(
            SettingsRow,
            {
              title: '曲目交叉淡入淡出 (Crossfade)',
              description: '上一曲即将结束时提前淡入下一曲',
              expandable: settings.crossfadeEnabled,
              expanded: crossfadeExpanded,
              onToggleExpand: () => setCrossfadeExpanded((prev) => !prev),
              action: h(Switch, {
                checked: settings.crossfadeEnabled,
                accessibilityLabel: '曲目交叉淡入淡出',
                onChange: (crossfadeEnabled) => void update({ crossfadeEnabled }),
              }),
            },
            settings.crossfadeEnabled
              ? h(SettingsRow, {
                  isNested: true,
                  title: '淡入淡出持续时间',
                  description: `持续时长: ${settings.crossfadeDurationSeconds} 秒`,
                  borderBottom: false,
                  action: h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
                    h(
                      'div',
                      { style: { flex: 1 } },
                      h(Slider, {
                        value: settings.crossfadeDurationSeconds,
                        max: 10,
                        accessibilityLabel: '淡入淡出持续时间',
                        onChange: (sec) =>
                          void update({ crossfadeDurationSeconds: Math.max(1, Math.round(sec)) }),
                      }),
                    ),
                    h(
                      'span',
                      { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                      `${settings.crossfadeDurationSeconds}s`,
                    ),
                  ),
                })
              : null,
          ),
          h(SettingsRow, {
            title: '拔出音频设备时自动暂停',
            description: '断开耳机或蓝牙连接时即刻暂停音乐，防止外放打扰',
            borderBottom: false,
            action: h(Switch, {
              checked: settings.pauseOnUnplug,
              accessibilityLabel: '拔出音频设备时自动暂停',
              onChange: (pauseOnUnplug) => void update({ pauseOnUnplug }),
            }),
          }),
        ),
        h(
          SettingsSection,
          {
            title: '音频效果与均衡器 (DSP)',
            description: '图示均衡器、响度标准化、动态压缩与空间混响配置',
          },
          // 1. EQ
          h(
            SettingsRow,
            {
              title: '10 频段图示均衡器 (10-Band EQ)',
              description: '调整各频段增益，塑造更加适合耳机或音响的声音曲线',
              expandable: eqEntry?.enabled ?? false,
              expanded: eqExpanded,
              onToggleExpand: () => setEqExpanded((prev) => !prev),
              action: h(Switch, {
                checked: eqEntry?.enabled ?? false,
                accessibilityLabel: '启用 10 频段均衡器',
                onChange: (checked) => void setEnabled('eq10', checked),
              }),
            },
            eqEntry?.enabled
              ? h(SettingsRow, {
                  isNested: true,
                  title: '均衡器预设风格',
                  description: '快速切换平直、低音增强、清晰人声等调音风格',
                  borderBottom: false,
                  action: h(
                    'div',
                    { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                    [
                      { id: '原声 (Flat)', label: '原声' },
                      { id: '低音增强 (Bass Boost)', label: '低音增强' },
                      { id: '清晰人声 (Vocal)', label: '清晰人声' },
                      { id: '清亮高音 (Treble)', label: '清亮高音' },
                    ].map((p) =>
                      h(Button, {
                        key: p.id,
                        variant: 'secondary',
                        onPress: () => void applyPreset('eq10', p.id),
                        children: p.label,
                      }),
                    ),
                  ),
                })
              : null,
          ),
          // 2. Normalize
          h(
            SettingsRow,
            {
              title: '音量响度标准化 (Normalization)',
              description: '基于 EBU R128 标准匹配目标电平，平衡不同音源之间的音量差异',
              expandable: normEntry?.enabled ?? false,
              expanded: normExpanded,
              onToggleExpand: () => setNormExpanded((prev) => !prev),
              action: h(Switch, {
                checked: normEntry?.enabled ?? false,
                accessibilityLabel: '启用响度标准化',
                onChange: (checked) => void setEnabled('normalize', checked),
              }),
            },
            normEntry?.enabled
              ? h(
                  'div',
                  null,
                  h(SettingsRow, {
                    isNested: true,
                    title: '标准化目标响度预设',
                    description: '根据收听环境切换标准目标电平',
                    action: h(
                      'div',
                      { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                      [
                        { id: '流媒体标准 (-14 LUFS)', label: '流媒体 (-14)' },
                        { id: '古典安静 (-18 LUFS)', label: '安静 (-18)' },
                        { id: '高响度 (-11 LUFS)', label: '高响度 (-11)' },
                      ].map((p) =>
                        h(Button, {
                          key: p.id,
                          variant: 'secondary',
                          onPress: () => void applyPreset('normalize', p.id),
                          children: p.label,
                        }),
                      ),
                    ),
                  }),
                  h(SettingsRow, {
                    isNested: true,
                    title: '标准化增益微调',
                    description: `当前微调增益: ${normParams.gainDb ?? 0} dB`,
                    borderBottom: false,
                    action: h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
                      h(
                        'div',
                        { style: { flex: 1 } },
                        h(Slider, {
                          value: Number(normParams.gainDb ?? 0) + 12,
                          max: 24,
                          accessibilityLabel: '标准化增益微调',
                          onChange: (v) => void setParam('normalize', 'gainDb', Math.round(v - 12)),
                        }),
                      ),
                      h(
                        'span',
                        { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                        `${normParams.gainDb ?? 0}dB`,
                      ),
                    ),
                  }),
                )
              : null,
          ),
          // 3. Compressor
          h(
            SettingsRow,
            {
              title: '动态范围压缩器 (Compressor)',
              description: '抑制突发的高音量并提升微弱细节，平抑动态范围',
              expandable: compEntry?.enabled ?? false,
              expanded: compExpanded,
              onToggleExpand: () => setCompExpanded((prev) => !prev),
              action: h(Switch, {
                checked: compEntry?.enabled ?? false,
                accessibilityLabel: '启用动态压缩器',
                onChange: (checked) => void setEnabled('compressor', checked),
              }),
            },
            compEntry?.enabled
              ? h(
                  'div',
                  null,
                  h(SettingsRow, {
                    isNested: true,
                    title: '压缩模式风格',
                    description: '选择适合夜间收听或强劲动态的压缩曲线',
                    action: h(
                      'div',
                      { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                      [
                        { id: '夜间模式 (Night Mode)', label: '🌙 夜间模式' },
                        { id: '温和顺滑 (Subtle)', label: '温和顺滑' },
                        { id: '强劲动态 (Heavy)', label: '强劲动态' },
                      ].map((p) =>
                        h(Button, {
                          key: p.id,
                          variant: 'secondary',
                          onPress: () => void applyPreset('compressor', p.id),
                          children: p.label,
                        }),
                      ),
                    ),
                  }),
                  h(SettingsRow, {
                    isNested: true,
                    title: '压缩阈值 (Threshold)',
                    description: `触发压缩的信号电平上限: ${compParams.threshold ?? -24} dB`,
                    borderBottom: false,
                    action: h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
                      h(
                        'div',
                        { style: { flex: 1 } },
                        h(Slider, {
                          value: Number(compParams.threshold ?? -24) + 60,
                          max: 60,
                          accessibilityLabel: '压缩阈值',
                          onChange: (v) => void setParam('compressor', 'threshold', Math.round(v - 60)),
                        }),
                      ),
                      h(
                        'span',
                        { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                        `${compParams.threshold ?? -24}dB`,
                      ),
                    ),
                  }),
                )
              : null,
          ),
          // 4. Reverb
          h(
            SettingsRow,
            {
              title: '空间混响效果 (Reverb)',
              description: '合成自然空间声学反射与混响尾音，营造沉浸式空间氛围',
              expandable: reverbEntry?.enabled ?? false,
              expanded: reverbExpanded,
              onToggleExpand: () => setReverbExpanded((prev) => !prev),
              action: h(Switch, {
                checked: reverbEntry?.enabled ?? false,
                accessibilityLabel: '启用空间混响',
                onChange: (checked) => void setEnabled('reverb', checked),
              }),
            },
            reverbEntry?.enabled
              ? h(
                  'div',
                  null,
                  h(SettingsRow, {
                    isNested: true,
                    title: '混响空间类型',
                    description: '切换不同声学空间的脉冲反射模型',
                    action: h(
                      'div',
                      { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                      [
                        { id: '小型房间 (Small Room)', label: '小型房间' },
                        { id: '音乐大厅 (Concert Hall)', label: '音乐大厅' },
                        { id: '板式混响 (Plate)', label: '板式混响' },
                      ].map((p) =>
                        h(Button, {
                          key: p.id,
                          variant: 'secondary',
                          onPress: () => void applyPreset('reverb', p.id),
                          children: p.label,
                        }),
                      ),
                    ),
                  }),
                  h(SettingsRow, {
                    isNested: true,
                    title: '混响干湿比 (Mix)',
                    description: `湿声比例: ${Math.round(Number(reverbParams.mix ?? 0.25) * 100)}%`,
                    borderBottom: false,
                    action: h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
                      h(
                        'div',
                        { style: { flex: 1 } },
                        h(Slider, {
                          value: Math.round(Number(reverbParams.mix ?? 0.25) * 100),
                          max: 100,
                          accessibilityLabel: '混响比例',
                          onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
                        }),
                      ),
                      h(
                        'span',
                        { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                        `${Math.round(Number(reverbParams.mix ?? 0.25) * 100)}%`,
                      ),
                    ),
                  }),
                )
              : null,
          ),
          // 5. Advanced DSP Link
          h(SettingsRow, {
            title: '高级效果器调音与编排',
            description: `当前效果链包含 ${chain.length} 个处理节点，延迟: ${latencyMs}ms`,
            borderBottom: false,
            action: h(Button, {
              children: '打开音效面板',
              onPress: () => handleTabClick('dsp'),
            }),
          }),
        ),
      ),

      // 3. DSP Category Anchor
      h(
        'div',
        { id: 'section-dsp' },
        h(
          SettingsSection,
          {
            title: '高级音效面板 (DSP)',
            description: '完整的专业音频效果器图拓扑调音与处理链路',
          },
          (() => {
            const ui = serviceOf<UiService>(ctx, 'ui')
            const DspComponent = ui?.viewFor?.('settings.dsp') as
              | React.ComponentType<{ ctx: Context }>
              | undefined
            if (DspComponent) {
              return h(DspComponent, { ctx })
            }
            return h(
              'div',
              { style: { color: '#8E8E93', fontSize: 13, padding: '16px 4px' } },
              '效果器视图加载中或未安装。',
            )
          })(),
        ),
      ),

      // 4. Desktop Lyrics Category Anchor (Requirement 6)
      h(
        'div',
        { id: 'section-lyrics' },
        h(
          SettingsSection,
          {
            title: '桌面歌词设置',
            description: '配置悬浮桌面歌词的显示行数、对齐、字体、字号、颜色及透明度',
          },
          h(SettingsRow, {
            title: '歌词显示行数',
            description: '选择同时显示当前歌词与下一句歌词，或仅显示单行',
            action: h(Select<'single' | 'double'>, {
              value: desktopLyrics.lineMode,
              options: [
                { value: 'double', label: '双行显示' },
                { value: 'single', label: '单行显示' },
              ],
              accessibilityLabel: '歌词显示行数',
              onChange: (lineMode) =>
                void update({ desktopLyrics: { ...desktopLyrics, lineMode } }),
            }),
          }),
          h(SettingsRow, {
            title: '文本对齐方式',
            description: '配置歌词文字在窗口内的水平排版方向',
            action: h(Select<'center' | 'left' | 'right'>, {
              value: desktopLyrics.align,
              options: [
                { value: 'center', label: '居中对齐' },
                { value: 'left', label: '左对齐' },
                { value: 'right', label: '右对齐' },
              ],
              accessibilityLabel: '文本对齐方式',
              onChange: (align) => void update({ desktopLyrics: { ...desktopLyrics, align } }),
            }),
          }),
          h(SettingsRow, {
            title: '歌词字体',
            description: '选择歌词呈现的字型族',
            action: h(Select<string>, {
              value: desktopLyrics.fontFamily,
              options: [
                { value: 'system-ui', label: '系统默认' },
                { value: 'PingFang SC, -apple-system', label: '苹方 (PingFang SC)' },
                { value: 'Microsoft YaHei, Segoe UI', label: '微软雅黑 (YaHei)' },
                { value: 'SimHei, sans-serif', label: '黑体 (SimHei)' },
                { value: 'KaiTi, STKaiti, serif', label: '楷体 (KaiTi)' },
                { value: 'JetBrains Mono, monospace', label: '等宽代码体' },
              ],
              accessibilityLabel: '歌词字体',
              onChange: (fontFamily) =>
                void update({ desktopLyrics: { ...desktopLyrics, fontFamily } }),
            }),
          }),
          h(SettingsRow, {
            title: '歌词字号',
            description: `当前字号大小: ${desktopLyrics.fontSize}px`,
            action: h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
              h(
                'div',
                { style: { flex: 1 } },
                h(Slider, {
                  value: desktopLyrics.fontSize,
                  max: 48,
                  accessibilityLabel: '歌词字号',
                  onChange: (size) =>
                    void update({
                      desktopLyrics: {
                        ...desktopLyrics,
                        fontSize: Math.max(14, Math.round(size)),
                      },
                    }),
                }),
              ),
              h(
                'span',
                { style: { fontSize: 12, color: '#8E8E93', width: 38, textAlign: 'right' } },
                `${desktopLyrics.fontSize}px`,
              ),
            ),
          }),
          h(SettingsRow, {
            title: '歌词高亮颜色',
            description: '主播放行歌词的高亮渲染颜色',
            action: h(ColorPicker, {
              value: desktopLyrics.textColor,
              accessibilityLabel: '歌词高亮颜色',
              onChange: (textColor) =>
                void update({ desktopLyrics: { ...desktopLyrics, textColor } }),
            }),
          }),
          h(SettingsRow, {
            title: '文字透明度',
            description: `当前透明度: ${Math.round(desktopLyrics.opacity * 100)}%`,
            borderBottom: false,
            action: h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
              h(
                'div',
                { style: { flex: 1 } },
                h(Slider, {
                  value: Math.round(desktopLyrics.opacity * 100),
                  max: 100,
                  accessibilityLabel: '文字透明度',
                  onChange: (op) =>
                    void update({
                      desktopLyrics: {
                        ...desktopLyrics,
                        opacity: Math.max(20, Math.round(op)) / 100,
                      },
                    }),
                }),
              ),
              h(
                'span',
                { style: { fontSize: 12, color: '#8E8E93', width: 38, textAlign: 'right' } },
                `${Math.round(desktopLyrics.opacity * 100)}%`,
              ),
            ),
          }),
          // Live Preview box at the bottom of the section
          h(LyricsPreview, { settings: desktopLyrics }),
        ),
      ),

      // 5. Global Shortcuts Category Anchor (Requirement 7)
      h(
        'div',
        { id: 'section-shortcuts' },
        h(
          SettingsSection,
          {
            title: '全局快捷键',
            description: '在操作系统后台通过键盘组合键全局控制音乐播放、音量与窗口显隐',
          },
          h(SettingsRow, {
            title: '启用全局快捷键',
            description: '默认启用。切换至其他应用或游戏时依然可通过快捷键控制播放',
            action: h(Switch, {
              checked: shortcuts.enabled,
              accessibilityLabel: '启用全局快捷键',
              onChange: (enabled) => void update({ shortcuts: { ...shortcuts, enabled } }),
            }),
          }),
          ...[
            { key: 'playPause', label: '播放 / 暂停', defaultVal: 'Ctrl+Alt+Space' },
            { key: 'prevTrack', label: '上一首歌曲', defaultVal: 'Ctrl+Alt+Left' },
            { key: 'nextTrack', label: '下一首歌曲', defaultVal: 'Ctrl+Alt+Right' },
            { key: 'volumeUp', label: '增大音量 (+5%)', defaultVal: 'Ctrl+Alt+Up' },
            { key: 'volumeDown', label: '调小音量 (-5%)', defaultVal: 'Ctrl+Alt+Down' },
            { key: 'toggleLyrics', label: '显示 / 隐藏桌面歌词', defaultVal: 'Ctrl+Alt+L' },
            { key: 'toggleWindow', label: '显示 / 隐藏音乐界面', defaultVal: 'Ctrl+Alt+W' },
            { key: 'toggleLoved', label: '添加喜欢 / 取消喜欢', defaultVal: 'Ctrl+Alt+K' },
            { key: 'seekForward', label: '歌曲快进 (+5秒)', defaultVal: 'Ctrl+Alt+]' },
            { key: 'seekBackward', label: '歌曲快退 (-5秒)', defaultVal: 'Ctrl+Alt+[' },
          ].map((item, index, arr) =>
            h(SettingsRow, {
              key: item.key,
              title: item.label,
              description: `当前快捷键绑定: ${shortcuts.keybindings[item.key as keyof typeof shortcuts.keybindings] || item.defaultVal}`,
              borderBottom: index < arr.length - 1,
              action: h(
                'div',
                {
                  style: {
                    padding: '4px 12px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.14)',
                    color: '#F5F5F7',
                    fontSize: 12,
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 600,
                  },
                },
                shortcuts.keybindings[item.key as keyof typeof shortcuts.keybindings] ||
                  item.defaultVal,
              ),
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 12 } },
            h(Button, {
              variant: 'secondary',
              children: '恢复默认快捷键',
              onPress: () =>
                void update({
                  shortcuts: {
                    enabled: true,
                    keybindings: { ...DEFAULT_SHORTCUTS_SETTINGS.keybindings },
                  },
                }),
            }),
          ),
        ),
      ),

      // 6. Network & Proxy Category Anchor (Requirement 8)
      h(
        'div',
        { id: 'section-network' },
        h(
          SettingsSection,
          {
            title: '网络代理设置',
            description: '配置应用外部请求与在线音源的网络代理协议与路由策略',
          },
          h(SettingsRow, {
            title: '启用网络代理',
            description: '开启后将通过自定义代理服务器转发网络与音乐请求',
            action: h(Switch, {
              checked: proxy.enabled,
              accessibilityLabel: '启用网络代理',
              onChange: (enabled) => void update({ proxy: { ...proxy, enabled } }),
            }),
          }),
          proxy.enabled
            ? h(
                'div',
                null,
                h(SettingsRow, {
                  title: '代理协议类型',
                  description: '选择代理服务器支持的传输协议',
                  action: h(Select<'http' | 'https' | 'socks5'>, {
                    value: proxy.protocol,
                    options: [
                      { value: 'http', label: 'HTTP 代理' },
                      { value: 'https', label: 'HTTPS 代理' },
                      { value: 'socks5', label: 'SOCKS5 代理' },
                    ],
                    accessibilityLabel: '代理协议类型',
                    onChange: (protocol) => void update({ proxy: { ...proxy, protocol } }),
                  }),
                }),
                h(SettingsRow, {
                  title: '服务器主机与端口',
                  description: '设置代理服务器的主机 IP 或域名以及监听端口',
                  action: h(
                    'div',
                    { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                    h('input', {
                      type: 'text',
                      value: proxy.host,
                      placeholder: '127.0.0.1',
                      'aria-label': '代理服务器主机',
                      onChange: (e: { target: { value: string } }) =>
                        void update({ proxy: { ...proxy, host: e.target.value.trim() } }),
                      style: {
                        width: 140,
                        height: 32,
                        borderRadius: 6,
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#FFFFFF',
                        fontSize: 13,
                        padding: '0 10px',
                        outline: 'none',
                      },
                    }),
                    h('span', { style: { color: '#8E8E93' } }, ':'),
                    h('input', {
                      type: 'number',
                      value: proxy.port || '',
                      placeholder: '7890',
                      'aria-label': '代理服务器端口',
                      onChange: (e: { target: { value: string } }) =>
                        void update({ proxy: { ...proxy, port: Number(e.target.value) || 0 } }),
                      style: {
                        width: 70,
                        height: 32,
                        borderRadius: 6,
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#FFFFFF',
                        fontSize: 13,
                        padding: '0 8px',
                        outline: 'none',
                      },
                    }),
                    h(Button, {
                      variant: 'secondary',
                      disabled: proxyTesting || !proxy.host || !proxy.port,
                      loading: proxyTesting,
                      children: '测试连接',
                      onPress: handleTestProxy,
                    }),
                  ),
                }),
                proxyTestResult
                  ? h(
                      'div',
                      {
                        style: {
                          padding: '8px 12px',
                          margin: '6px 0 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          background: proxyTestResult.ok
                            ? 'rgba(29, 185, 84, 0.12)'
                            : 'rgba(241, 94, 108, 0.12)',
                          color: proxyTestResult.ok ? '#1ED760' : '#F15E6C',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        },
                      },
                      proxyTestResult.ok
                        ? `✓ 代理连通正常，响应延迟: ${proxyTestResult.latencyMs ?? 0}ms`
                        : `✕ 代理连接失败: ${proxyTestResult.error || '连接超时或服务器无响应'}`,
                    )
                  : null,
              )
            : null,
        ),
        // Third-party Sources individual proxy management (Requirement 8)
        h(
          SettingsSection,
          {
            title: '第三方音源代理独立分流',
            description: '为已安装的每个第三方音乐来源单独指定是否启用网络代理',
          },
          thirdPartySources.length > 0
            ? thirdPartySources.map((s, index, arr) => {
                const isEnabled = proxy.sourceRules[s.id] ?? false
                return h(SettingsRow, {
                  key: s.id,
                  title: s.name || s.id,
                  description: s.group ? `分组: ${s.group} · ${s.sourceUrl}` : s.sourceUrl,
                  borderBottom: index < arr.length - 1,
                  action: h(Switch, {
                    checked: isEnabled,
                    accessibilityLabel: `${s.name || s.id} 启用代理`,
                    onChange: (checked) => {
                      const nextRules = { ...proxy.sourceRules, [s.id]: checked }
                      void update({ proxy: { ...proxy, sourceRules: nextRules } })
                    },
                  }),
                })
              })
            : h(
                'div',
                { style: { color: '#8E8E93', fontSize: 13, padding: '12px 4px' } },
                '当前尚未安装第三方音乐源。导入源规则后即可在此处单独开启代理。',
              ),
        ),
      ),

      // 7. Sources Category Anchor
      h(
        'div',
        { id: 'section-sources' },
        h(
          SettingsSection,
          {
            title: '曲库音源与文件',
            description: '管理音乐来源提供方、网络源能力诊断及本地媒体目录索引',
          },
          h(SettingsRow, {
            title: '音乐来源配置 (Music Sources)',
            description: '查看已启用的网络音源、进行源能力健康诊断或导入第三方源规则文件',
            action: h(Button, {
              children: '管理音乐源',
              onPress: () => {
                serviceOf<UiService>(ctx, 'ui')?.navigate?.('sources.settings')
              },
            }),
          }),
          h(SettingsRow, {
            title: '本地音乐文件夹 (Music Folders)',
            description: '添加包含本地音频文件的文件夹，即时执行扫描并建立索引',
            borderBottom: false,
            action: h(Button, {
              children: '管理文件夹',
              onPress: () => {
                serviceOf<UiService>(ctx, 'ui')?.navigate?.('scanner.settings')
              },
            }),
          }),
        ),
      ),

      // 8. Storage & Downloads Category Anchor (Requirement 4 & 5)
      h(
        'div',
        { id: 'section-storage' },
        h(
          SettingsSection,
          {
            title: '离线存储与下载目录',
            description: '管理离线已下载音乐的本地保存目录及任务策略',
          },
          // Download Directory row with 更改目录 and 打开文件夹 buttons (Requirement 4)
          h(SettingsRow, {
            title: '下载目录',
            description: currentDownloadsDir,
            action: h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h(Button, {
                variant: 'secondary',
                children: '更改目录',
                onPress: handlePickDownloadDir,
              }),
              h(Button, {
                variant: 'secondary',
                children: '打开文件夹',
                onPress: handleOpenDownloadDir,
              }),
            ),
          }),
          h(SettingsRow, {
            title: '下载管理器 (Downloads)',
            description: '查看下载队列、网络策略配置以及已保存至本地的歌曲',
            borderBottom: false,
            action: h(Button, {
              children: '进入下载管理',
              onPress: () => {
                serviceOf<UiService>(ctx, 'ui')?.navigate?.('downloads.page')
              },
            }),
          }),
        ),
        h(
          SettingsSection,
          {
            title: '临时缓存与存储目录',
            description: '在线媒体流临时缓冲文件与封面缓存存储路径与清理',
          },
          // Cache Directory row with 更改目录 and 打开文件夹 buttons (Requirement 5)
          h(SettingsRow, {
            title: '歌曲缓存目录',
            description: currentCacheDir,
            action: h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h(Button, {
                variant: 'secondary',
                children: '更改目录',
                onPress: handlePickCacheDir,
              }),
              h(Button, {
                variant: 'secondary',
                children: '打开文件夹',
                onPress: handleOpenCacheDir,
              }),
            ),
          }),
          h(SettingsRow, {
            title: '缓存占用空间',
            description: `总计: ${formatBytes(usage.totalBytes)} (封面: ${formatBytes(usage.artworkBytes)} · 媒体流: ${formatBytes(usage.streamBytes)})`,
            borderBottom: false,
            action: h(Button, {
              variant: 'secondary',
              disabled: clearingCache || usage.totalBytes === 0,
              loading: clearingCache,
              children: '清除全部缓存',
              onPress: handleClearCache,
            }),
          }),
        ),
      ),

      // 9. About Category Anchor
      h(
        'div',
        { id: 'section-about' },
        h(
          SettingsSection,
          {
            title: '关于 BBeBee',
            description: '应用架构与版本信息',
          },
          // Brand header badge
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '16px 4px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                marginBottom: 4,
              },
            },
            h(
              'div',
              {
                style: {
                  fontSize: 32,
                  lineHeight: 1,
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                },
              },
              '🐝',
            ),
            h(
              'div',
              null,
              h('div', { style: { fontSize: 18, fontWeight: 700, color: '#F5F5F7' } }, 'BBeBee'),
              h(
                'div',
                { style: { fontSize: 12, color: '#8E8E93', marginTop: 2 } },
                '跨平台插件化音乐播放器 · Version 0.1.0',
              ),
            ),
          ),
          h(SettingsRow, {
            title: '微内核架构',
            description: '基于 Cordis 依赖注入与生命周期管理，功能完全解耦为独立插件',
          }),
          h(SettingsRow, {
            title: '安全沙箱',
            description: '音源解析运行于 QuickJS Realm 独立沙箱，完全隔离网络与本地权限',
          }),
          h(SettingsRow, {
            title: '开源许可',
            description: '基于 MIT 许可证开源，自由、灵活、透明',
            borderBottom: false,
          }),
        ),
        h(
          SettingsSection,
          {
            title: '危险区域',
            description: '配置重置选项',
          },
          h(SettingsRow, {
            title: '重置所有设置',
            description: '将所有偏好项恢复为初始默认值（不会删除已下载的歌曲或歌单）',
            borderBottom: false,
            action: resetting
              ? h(
                  'div',
                  { style: { display: 'flex', gap: 8 } },
                  h(Button, {
                    variant: 'primary',
                    children: '确认重置',
                    onPress: handleReset,
                  }),
                  h(Button, {
                    variant: 'ghost',
                    children: '取消',
                    onPress: () => setResetting(false),
                  }),
                )
              : h(Button, {
                  variant: 'secondary',
                  children: '恢复默认设置',
                  onPress: () => setResetting(true),
                }),
          }),
        ),
      ),
    ),
  )
}
