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
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAEfklEQVR42u3dUU7kQBAFwTk3lx8ugARibHdXZ6T0/hfjCs2KXfF6SZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIk3d3X+/3jtP574PsgAABAAgAApJtfNi/i3t8D3wcBAADSmpfPC7j22Xv+AgAApLUvoRdxzTP3/AUAAHj+AgAAJAAAQFr5MsrhCwACgKovpZf0uWcsAQAAEggcvgQAAEhe3rOenQQAAEjzX3LPxHELAJ4JAFR++atfuwQAAEggmHoQPupLAACAVDwQhy8BAAASAAAgfXwsDl8CAAAkEMz9GiQBQNIpAPjoLwEAAFIRAocvAQAA0lNH5aO/BAAASKteantuEgAAIAHAYCEAGAAEAAOCAGAAEAAMDAKAAUAAMBAIAAYAAcCAIAAYAAQAA4EAYAAQAAwEAoABAABmAACAGQgAYAYAAJjBAABmAACAGQgAYAAQAAwAAoABQAAwEAgABgABwAAgABgABIBJ+y3PCAQAAIABAABFAEAAAAAAwLMCAADKAIAAAAAAgGcGAAAAwEAAAAAAQABoAQACAAAAAJ4dAABQBgAGAAAAAAAgAAAAAAIAAAAgAPQAyEIgAAAAAAIAAAAgALQByIEgAAAAAAIAAIoQCAAAAIAAAIAiBAIAAAAgAACgCIEAAAAACAAAKEIgAAAAAAIAAIoQCAAAAIAAAIAiBAIAAAAgAACgCIEAAAAACAC53w6chkAAAAAABIAsAE/8dQIAAgAAACAATADgahAcvgAAAAAIABMBuBIEAAgAAACAAAAAAAgA4wD4BAKHLwAAAAACwHQA/gMBAAQAAABAADgFgO0hEAAAAAABAAAVAAQAAABAAADAwx+9l/45BAAAAEAAAEAJAAEAAAAQAACwyY/fbv1zSA4fAAKAAUAAAAAABAAAbA2AH/8JAAAAgAAAACAIAAAAgAAAABgIAAAAgAAAABAIAAAAgAAw+z8D+d2AAgAAACAAAAAEAgAAACAAAAAAAsChAGz/3AQAAABAAABAeQIAAAAgAAAABAIAAAAgAAAAAAIAAAAgACz5LbpX59BBAAAAGAAAUDh4AAAAAAAAAAAAUDx4AAAAAAAAAAAAUD58AEAAAABw2AAAQPHwAQAAAADAYQMAAMXDBwAAAAAAhw0AAADAAAAAABgAANA4fAAAAAAAcNgAAAAADAAAAIABAAAAMAAAwOEbAAAAAAMAAAAAAAEAAAAQAAAAAAEAAAAQABw+AAQAAABA/iGQwweAAAAAAAgADh8AAgAAAKBjAfA7/wAgAAAAACoDsAMEjtXxAwAABgAAFCBwoAAQAAwAmvJCOXQACAAAAICKAJjDFwAMAAKAAUAAMAAIAAYAAcAcvgBgABAADAACgAFAADCHLwAYAAQAc/gCgAFAXmZz+AAwAwAAzBw+AMwAAABz9AKAAUAAMIcvABgABABz8AKAAUAAMIcvABgABABz6AKAAUAAMIcuABgABABzzAKAAUCSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJOmvfQN09Vq/FoX4BgAAAABJRU5ErkJggg=='

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
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
              flexShrink: 0,
            },
          },
          h('img', {
            src: BBEBEE_LOGO_DATA_URL,
            alt: 'BBeBee Logo',
            width: 38,
            height: 38,
            style: { display: 'block', objectFit: 'contain' },
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
