import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { AppSettings, ThemeDefinition, ThemeService } from '@BBeBee/protocol'
import { Select } from '../Select.js'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'
import { Switch } from '../Switch.js'

export function GeneralSection({
  ctx,
  settings,
  update,
  onCloseToTrayChange,
}: {
  ctx?: Context
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<unknown>
  onCloseToTrayChange: (closeToTray: boolean) => void
}): ReactElement {
  const themeService = ctx ? serviceOf<ThemeService>(ctx, 'theme') : undefined

  const [themes, setThemes] = useState<readonly (ThemeDefinition | { id: string; name: string })[]>(() => {
    return themeService?.getThemes?.() ?? [
      { id: 'midnight-purple', name: '蓝紫暗夜 (Midnight Purple)' },
      { id: 'spotify', name: 'Spotify 经典绿 (Spotify Classic)' },
    ]
  })

  useEffect(() => {
    if (!ctx) return
    const updateThemes = () => {
      const svc = serviceOf<ThemeService>(ctx, 'theme')
      const list = svc?.getThemes?.()
      if (list) setThemes(list)
    }
    updateThemes()
    const off1 = ctx.on('theme/registry-changed', updateThemes)
    const off2 = ctx.on('theme/changed', updateThemes)
    return () => {
      off1()
      off2()
    }
  }, [ctx])

  const currentThemeId = settings.themeId ?? themeService?.getCurrentTheme?.().id ?? 'midnight-purple'

  const handleThemeChange = (themeId: string) => {
    void update({ themeId })
    const svc = ctx ? serviceOf<ThemeService>(ctx, 'theme') : undefined
    svc?.setTheme?.(themeId)
  }

  return h(
    'div',
    { id: 'section-general' },
    h(
      SettingsSection,
      {
        title: '主题与色彩管理',
        description: '切换播放器主题风格，支持深色蓝紫与经典绿色，或在运行时动态注册更多色彩',
      },
      h(SettingsRow, {
        title: '界面主题',
        description: '选择全应用色彩方案',
        borderBottom: false,
        action: h(
          'div',
          { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
          themes.map((t) => {
            const isSelected = currentThemeId === t.id
            const isMidnight = t.id === 'midnight-purple'
            const isSpotify = t.id === 'spotify'
            const swatchBg = isMidnight
              ? 'linear-gradient(135deg, #5F87FF 0%, #7C86FF 50%, #A99CFF 100%)'
              : isSpotify
                ? '#1DB954'
                : ('tokens' in t ? t.tokens?.brand?.primary : undefined) ?? 'var(--color-primary, #5F87FF)'

            return h(
              'button',
              {
                key: t.id,
                type: 'button',
                onClick: () => handleThemeChange(t.id),
                'aria-pressed': isSelected,
                'data-testid': `theme-option-${t.id}`,
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: isSelected
                    ? '1px solid var(--color-primary, #5F87FF)'
                    : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                  background: isSelected
                    ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))'
                    : 'rgba(255, 255, 255, 0.04)',
                  color: isSelected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-secondary, #C5CAD8)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isSelected ? 600 : 400,
                  boxShadow: isSelected ? 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.25))' : 'none',
                  transition: 'all 0.15s ease',
                },
              },
              h('span', {
                style: {
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: swatchBg,
                  flexShrink: 0,
                  boxShadow: '0 0 4px rgba(0, 0, 0, 0.3)',
                },
              }),
              t.name,
            )
          }),
        ),
      }),
    ),
    h(
      SettingsSection,
      {
        title: '常规与界面语言',
        description: '设置应用程序的界面语言与显示偏好',
      },
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
          onChange: onCloseToTrayChange,
        }),
      }),
    ),
  )
}
