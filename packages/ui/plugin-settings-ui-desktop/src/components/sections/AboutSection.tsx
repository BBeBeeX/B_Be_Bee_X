import { createElement as h } from 'react'
import type { ReactElement, ChangeEvent } from 'react'
import { Button } from '@BBeBee/ui-kit-desktop'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface AboutSectionProps {
  showAdvancedSettings: boolean
  resetting: boolean
  onToggleAdvancedSettings: (show: boolean) => void
  onSetResetting: (resetting: boolean) => void
  onReset: () => void
  onNavigate: (route: string) => void
}

const BBEBEE_LOGO_DATA_URL =
  'data:image/png;base64,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'

export function AboutSection({
  showAdvancedSettings,
  resetting,
  onToggleAdvancedSettings,
  onSetResetting,
  onReset,
  onNavigate,
}: AboutSectionProps): ReactElement {
  return h(
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
              width: 52,
              height: 52,
              borderRadius: 14,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
              flexShrink: 0,
            },
          },
          h('img', {
            src: BBEBEE_LOGO_DATA_URL,
            alt: 'BBeBee Logo',
            width: 52,
            height: 52,
            style: { display: 'block', objectFit: 'cover' },
          }),
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
    // Advanced Settings Checkbox Toggle
    h(
      'div',
      {
        style: {
          padding: '12px 4px 16px',
          display: 'flex',
          alignItems: 'center',
        },
      },
      h(
        'label',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            fontSize: 13,
            color: showAdvancedSettings ? '#F8FAFC' : '#94A3B8',
            userSelect: 'none',
            padding: '6px 14px',
            borderRadius: 6,
            background: showAdvancedSettings
              ? 'rgba(124, 58, 237, 0.15)'
              : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${showAdvancedSettings ? 'rgba(124, 58, 237, 0.35)' : 'rgba(255, 255, 255, 0.08)'}`,
            transition: 'all 0.15s ease',
          },
        },
        h('input', {
          type: 'checkbox',
          checked: showAdvancedSettings,
          onChange: (e: ChangeEvent<HTMLInputElement>) =>
            onToggleAdvancedSettings(e.target.checked),
          style: {
            cursor: 'pointer',
            accentColor: '#7C3AED',
            width: 15,
            height: 15,
          },
        }),
        h('span', { style: { fontWeight: 500 } }, '高级设置'),
      ),
    ),
    // Developer diagnostics and Danger zone appear only when advanced settings is enabled
    showAdvancedSettings &&
      h(
        SettingsSection,
        {
          title: '开发者与系统诊断',
          description: '查看运行环境、Discover 实时日志、音源测试与微内核架构拓扑 (Inspector)',
        },
        h(SettingsRow, {
          title: '调试与诊断中心 (Debug)',
          description:
            '包含环境信息、Discover 系统日志、音源 HTTP 抓包、音源测试及 Inspector 架构拓扑',
          borderBottom: false,
          action: h(Button, {
            variant: 'secondary',
            children: '进入 Debug 调试中心 →',
            onPress: () => onNavigate('debug.view'),
          }),
        }),
      ),
    showAdvancedSettings &&
      h(
        SettingsSection,
        {
          title: '危险区域',
          description: '底层配置重置选项',
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
                  onPress: onReset,
                }),
                h(Button, {
                  variant: 'ghost',
                  children: '取消',
                  onPress: () => onSetResetting(false),
                }),
              )
            : h(Button, {
                variant: 'secondary',
                children: '恢复默认设置',
                onPress: () => onSetResetting(true),
              }),
        }),
      ),
  )
}
