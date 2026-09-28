import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { DesktopLyricsService, DesktopLyricsSettings } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { Slider } from '@BBeBee/ui-kit-desktop'
import { ColorPicker } from '../ColorPicker.js'
import { LyricsPreview } from '../LyricsPreview.js'
import { Select } from '../Select.js'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'
import { LyricSourcesSection } from './LyricSourcesSection.js'
import { Switch } from '../Switch.js'

export function LyricsSection({
  ctx,
  desktopLyrics,
  isDesktopLyricsVisible,
  update,
}: {
  ctx: Context
  desktopLyrics: DesktopLyricsSettings
  isDesktopLyricsVisible: boolean
  update: (patch: { desktopLyrics: DesktopLyricsSettings }) => Promise<unknown>
}): ReactElement {
  return h(
    'div',
    { id: 'section-lyrics', style: { display: 'flex', flexDirection: 'column', gap: 24 } },
    h(
      SettingsSection,
      {
        title: '桌面歌词设置',
        description: '配置悬浮桌面歌词的显示行数、对齐、字体、字号、颜色及透明度',
      },
      h(SettingsRow, {
        title: '开启桌面歌词',
        description: '在屏幕最上层显示悬浮桌面歌词窗口',
        action: h(Switch, {
          checked: isDesktopLyricsVisible,
          accessibilityLabel: '开启桌面歌词',
          onChange: (enabled) => {
            void update({ desktopLyrics: { ...desktopLyrics, enabled } })
            const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
            dl?.setVisible?.(enabled)
          },
        }),
      }),
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
      h(LyricsPreview, { settings: desktopLyrics }),
    ),
    h(LyricSourcesSection, { ctx }),
  )
}
