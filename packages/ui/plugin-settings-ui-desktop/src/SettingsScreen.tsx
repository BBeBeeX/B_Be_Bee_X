/**
 * Desktop Settings Screen for `@BBeBee/plugin-settings`.
 * Single-page natural scrolling layout with section anchors and text-only tab navigation.
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, Slider } from '@BBeBee/ui-kit-desktop'
import { useAppSettings, useCacheStats } from '@BBeBee/plugin-settings/hooks'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'
import { Switch } from './components/Switch.js'
import { Select } from './components/Select.js'
import { SettingsRow } from './components/SettingsRow.js'
import { SettingsSection } from './components/SettingsSection.js'

export type SettingsTab = 'general' | 'playback' | 'dsp' | 'sources' | 'storage' | 'about'

export interface TabItem {
  id: SettingsTab
  label: string
}

export const TABS: readonly TabItem[] = [
  { id: 'general', label: '常规与外观' },
  { id: 'playback', label: '播放与音频' },
  { id: 'dsp', label: '音效均衡器' },
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
  const scrollContainerRef = useRef<HTMLElement>(null)
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
    if (typeof IntersectionObserver === 'undefined' || !scrollContainerRef.current) return
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
        root: scrollContainerRef.current,
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
        height: '100%',
        minHeight: 500,
        maxWidth: 1040,
        margin: '0 auto',
        padding: '24px 32px',
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
          top: 0,
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
    // Right Main Scrollable Area (Single Page, All Sections in DOM)
    h(
      'main',
      {
        ref: scrollContainerRef,
        style: {
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          paddingRight: 12,
          scrollBehavior: 'smooth',
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
              onChange: (closeToTray) => void update({ closeToTray }),
            }),
          }),
        ),
      ),

      // 2. Playback Category Anchor
      h(
        'div',
        { id: 'section-playback' },
        h(
          SettingsSection,
          {
            title: '音频输出与音量',
            description: '配置音频引擎启动音量及基础输出行为',
          },
          h(SettingsRow, {
            title: '默认音量',
            description: `当前默认初始音量: ${settings.defaultVolume}%`,
            borderBottom: false,
            action: h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
              h(
                'div',
                { style: { flex: 1 } },
                h(Slider, {
                  value: settings.defaultVolume,
                  max: 100,
                  accessibilityLabel: '默认音量',
                  onChange: (v) => void update({ defaultVolume: Math.round(v) }),
                }),
              ),
              h(
                'span',
                { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                `${settings.defaultVolume}%`,
              ),
            ),
          }),
        ),
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
            const DspComponent = ctx.ui?.viewFor?.('settings.dsp') as
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

      // 4. Sources Category Anchor
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
                ctx.ui?.navigate?.('sources.settings')
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
                ctx.ui?.navigate?.('scanner.settings')
              },
            }),
          }),
        ),
      ),

      // 5. Storage Category Anchor
      h(
        'div',
        { id: 'section-storage' },
        h(
          SettingsSection,
          {
            title: '离线存储',
            description: '离线下载任务与存储位置策略',
          },
          h(SettingsRow, {
            title: '下载管理器 (Downloads)',
            description: '查看下载队列、网络策略配置以及已保存至本地的歌曲',
            borderBottom: false,
            action: h(Button, {
              children: '进入下载管理',
              onPress: () => {
                ctx.ui?.navigate?.('downloads.page')
              },
            }),
          }),
        ),
        h(
          SettingsSection,
          {
            title: '临时缓存',
            description: '在线媒体临时缓存文件与封面存储管理',
          },
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

      // 6. About Category Anchor
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
