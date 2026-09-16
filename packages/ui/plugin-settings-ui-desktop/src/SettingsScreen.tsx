/**
 * Desktop Settings Screen for `@BBeBee/plugin-settings`.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, Slider } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { useAppSettings, useCacheStats } from '@BBeBee/plugin-settings/hooks'
import { Switch } from './components/Switch.js'
import { SegmentedControl } from './components/SegmentedControl.js'
import { SettingsRow } from './components/SettingsRow.js'
import { SettingsSection } from './components/SettingsSection.js'

type SettingsTab = 'general' | 'playback' | 'sources' | 'storage' | 'about'

interface TabItem {
  id: SettingsTab
  label: string
  icon: string
}

const TABS: readonly TabItem[] = [
  { id: 'general', label: '常规与外观', icon: '🎨' },
  { id: 'playback', label: '播放与音频', icon: '🎵' },
  { id: 'sources', label: '曲库与来源', icon: '📂' },
  { id: 'storage', label: '存储与缓存', icon: '💾' },
  { id: 'about', label: '关于应用', icon: 'ℹ️' },
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
  const { settings, update, reset } = useAppSettings(ctx)
  const { usage, clear } = useCacheStats(ctx)
  const [clearingCache, setClearingCache] = useState(false)
  const [resetting, setResetting] = useState(false)

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
        maxWidth: 1000,
        margin: '0 auto',
        padding: '24px 32px',
        gap: 32,
      },
    },
    // Left Tab List
    h(
      'aside',
      {
        style: {
          width: 180,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          flexShrink: 0,
        },
      },
      h(
        'div',
        {
          style: {
            fontSize: 20,
            fontWeight: 700,
            color: '#f5f5f7',
            padding: '8px 12px 16px',
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
            type: 'button',
            onClick: () => setActiveTab(tab.id),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderRadius: tokens.radius.sm,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              textAlign: 'left',
              background: isSelected ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
              color: isSelected ? '#ffffff' : '#8e8e93',
              fontWeight: isSelected ? 600 : 400,
              transition: 'background-color 0.15s',
            },
          },
          h('span', { style: { fontSize: 16 } }, tab.icon),
          h('span', null, tab.label),
        )
      }),
    ),
    // Right Content Area
    h(
      'main',
      {
        style: {
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          paddingRight: 8,
        },
      },
      activeTab === 'general' &&
        h(
          'div',
          null,
          h(
            SettingsSection,
            { title: '外观与个性化', description: '调整应用程序界面的视觉呈现方式' },
            h(SettingsRow, {
              title: '外观主题',
              description: '选择应用的主题风格或与操作系统外观同步',
              action: h(SegmentedControl<'dark' | 'light' | 'system'>, {
                value: settings.theme,
                options: [
                  { value: 'dark', label: '深色' },
                  { value: 'light', label: '浅色' },
                  { value: 'system', label: '跟随系统' },
                ],
                onChange: (theme) => void update({ theme }),
              }),
            }),
            h(SettingsRow, {
              title: '界面语言',
              description: '设置显示的语言选项',
              action: h(SegmentedControl<'zh' | 'en'>, {
                value: settings.language === 'en' ? 'en' : 'zh',
                options: [
                  { value: 'zh', label: '简体中文' },
                  { value: 'en', label: 'English' },
                ],
                onChange: (language) => void update({ language }),
              }),
            }),
          ),
          h(
            SettingsSection,
            { title: '系统行为', description: '桌面端窗口及托盘运行策略' },
            h(SettingsRow, {
              title: '关闭主窗口时最小化到系统托盘',
              description: '开启后点击关闭按钮不会退出应用程序，而是保留在托盘后台运行',
              action: h(Switch, {
                checked: settings.closeToTray,
                accessibilityLabel: '关闭主窗口时最小化到系统托盘',
                onChange: (closeToTray) => void update({ closeToTray }),
              }),
            }),
          ),
        ),
      activeTab === 'playback' &&
        h(
          'div',
          null,
          h(
            SettingsSection,
            { title: '音频输出与音量', description: '配置音频引擎启动音量及基础输出行为' },
            h(SettingsRow, {
              title: '默认音量',
              description: `当前默认初始音量: ${settings.defaultVolume}%`,
              action: h(
                'div',
                { style: { width: 180 } },
                h(Slider, {
                  value: settings.defaultVolume,
                  max: 100,
                  accessibilityLabel: '默认音量',
                  onChange: (v) => void update({ defaultVolume: Math.round(v) }),
                }),
              ),
            }),
          ),
          h(
            SettingsSection,
            { title: '过渡与衔接', description: '连续播放歌曲时的淡入淡出与连接体验' },
            h(SettingsRow, {
              title: '无缝播放 (Gapless Playback)',
              description: '在两首歌曲之间消除解码停顿，体验连贯的听歌流动感',
              action: h(Switch, {
                checked: settings.gaplessPlayback,
                accessibilityLabel: '无缝播放',
                onChange: (gaplessPlayback) => void update({ gaplessPlayback }),
              }),
            }),
            h(SettingsRow, {
              title: '曲目交叉淡入淡出 (Crossfade)',
              description: '上一曲即将结束时提前淡入下一曲',
              action: h(Switch, {
                checked: settings.crossfadeEnabled,
                accessibilityLabel: '曲目交叉淡入淡出',
                onChange: (crossfadeEnabled) => void update({ crossfadeEnabled }),
              }),
            }),
            settings.crossfadeEnabled
              ? h(SettingsRow, {
                  title: '淡入淡出持续时间',
                  description: `持续时长: ${settings.crossfadeDurationSeconds} 秒`,
                  action: h(
                    'div',
                    { style: { width: 180 } },
                    h(Slider, {
                      value: settings.crossfadeDurationSeconds,
                      max: 10,
                      accessibilityLabel: '淡入淡出持续时间',
                      onChange: (sec) =>
                        void update({ crossfadeDurationSeconds: Math.max(1, Math.round(sec)) }),
                    }),
                  ),
                })
              : null,
            h(SettingsRow, {
              title: '拔出音频设备时自动暂停',
              description: '断开耳机或蓝牙连接时即刻暂停音乐，防止外放打扰',
              action: h(Switch, {
                checked: settings.pauseOnUnplug,
                accessibilityLabel: '拔出音频设备时自动暂停',
                onChange: (pauseOnUnplug) => void update({ pauseOnUnplug }),
              }),
            }),
          ),
        ),
      activeTab === 'sources' &&
        h(
          'div',
          null,
          h(
            SettingsSection,
            { title: '曲库音源与文件', description: '管理音乐来源提供方及本地媒体扫描' },
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
              action: h(Button, {
                children: '管理文件夹',
                onPress: () => {
                  ctx.ui?.navigate?.('scanner.settings')
                },
              }),
            }),
          ),
        ),
      activeTab === 'storage' &&
        h(
          'div',
          null,
          h(
            SettingsSection,
            { title: '离线存储', description: '离线下载任务与存储管理' },
            h(SettingsRow, {
              title: '下载管理器 (Downloads)',
              description: '查看下载队列、网络策略配置以及已保存至本地的歌曲',
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
            { title: '临时缓存', description: '封面图及在线流媒体临时缓存文件' },
            h(SettingsRow, {
              title: '缓存占用空间',
              description: `总计: ${formatBytes(usage.totalBytes)} (封面: ${formatBytes(usage.artworkBytes)} · 媒体流: ${formatBytes(usage.streamBytes)})`,
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
      activeTab === 'about' &&
        h(
          'div',
          null,
          h(
            SettingsSection,
            { title: '关于 BBeBee', description: '应用架构与版本信息' },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '16px 20px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  marginBottom: 12,
                },
              },
              h(
                'div',
                {
                  style: {
                    fontSize: 36,
                    lineHeight: 1,
                    width: 54,
                    height: 54,
                    borderRadius: 12,
                    background: '#2A2340',
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
                h('div', { style: { fontSize: 18, fontWeight: 700, color: '#f5f5f7' } }, 'BBeBee'),
                h(
                  'div',
                  { style: { fontSize: 12, color: '#8e8e93', marginTop: 2 } },
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
            }),
          ),
          h(
            SettingsSection,
            { title: '危险区域', description: '配置重置选项' },
            h(SettingsRow, {
              title: '重置所有设置',
              description: '将所有偏好项恢复为初始默认值（不会删除已下载的歌曲或歌单）',
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
