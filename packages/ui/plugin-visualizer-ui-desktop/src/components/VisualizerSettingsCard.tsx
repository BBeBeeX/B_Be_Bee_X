/**
 * VisualizerSettingsCard — Settings section for configuring audio visualizer.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { VisualizerColorTheme, VisualizerStyle } from '@BBeBee/protocol'
import { useVisualizer } from '@BBeBee/plugin-visualizer/hooks'
import { Slider, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { VisualizerCanvas } from './VisualizerCanvas.js'

export interface VisualizerSettingsCardProps {
  ctx: Context
}

const STYLES: { id: VisualizerStyle; label: string; icon: string; desc: string }[] = [
  { id: 'bars', label: '频谱柱状图', icon: 'chart-bar', desc: '经典多频段跳动频谱条' },
  { id: 'wave', label: '平滑波形图', icon: 'wave-sine', desc: '柔和流动的声波示波曲线' },
  { id: 'circle', label: '环形辐射谱', icon: 'circle-dot', desc: '中心辐射 360 度动态光圈' },
  { id: 'particles', label: '律动光点', icon: 'sparkles', desc: '随音量脉冲浮动的粒子点群' },
]

const THEMES: { id: VisualizerColorTheme; label: string; color: string }[] = [
  { id: 'accent', label: '蓝紫霓光', color: 'linear-gradient(135deg, #5865F2, #A855F7)' },
  { id: 'neon', label: '极光青绿', color: 'linear-gradient(135deg, #00FF87, #60EFFF)' },
  { id: 'rainbow', label: '彩虹幻彩', color: 'linear-gradient(135deg, #FF0844, #FFB199, #FEE140, #38F9D7)' },
  { id: 'monochrome', label: '极简银白', color: 'linear-gradient(135deg, #FFFFFF, #8E8E93)' },
]

export function VisualizerSettingsCard({ ctx }: VisualizerSettingsCardProps): ReactElement {
  const { settings, updateSettings } = useVisualizer(ctx)

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: '20px 24px',
        borderRadius: 12,
        background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
      },
    },
    // Header & Master Switch
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Text, { variant: 'md', children: '音频可视化 (Audio Visualizer)' }),
        h(Text, {
          variant: 'sm',
          tone: 'muted',
          children: '在播放界面呈现音乐频率跳动与声波流动效果',
        }),
      ),
      h(
        'label',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            cursor: 'pointer',
          },
        },
        h('input', {
          type: 'checkbox',
          checked: settings.enabled,
          onChange: (e: { target: { checked: boolean } }) => {
            void updateSettings({ enabled: e.target.checked })
          },
          style: {
            width: 44,
            height: 24,
            appearance: 'none',
            outline: 'none',
            backgroundColor: settings.enabled ? 'var(--primary, #6366F1)' : 'rgba(255, 255, 255, 0.2)',
            boxShadow: settings.enabled ? 'var(--glow-xs, 0 0 10px rgba(99, 102, 241, 0.35))' : 'none',
            borderRadius: 12,
            position: 'relative',
            cursor: 'pointer',
            transition: 'background-color 0.2s, box-shadow 0.2s',
          },
        }),
      ),
    ),

    settings.enabled
      ? h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
          // Live Preview Area
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 16,
                borderRadius: 8,
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                alignItems: 'center',
              },
            },
            h(
              'div',
              {
                style: {
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                },
              },
              h(Text, { variant: 'xs', tone: 'muted', children: '实时效果预览' }),
              h(Text, {
                variant: 'xs',
                tone: 'muted',
                children: STYLES.find((s) => s.id === settings.style)?.label ?? '',
              }),
            ),
            h(VisualizerCanvas, {
              ctx,
              height: 64,
              previewStyle: settings.style,
              previewTheme: settings.colorTheme,
            }),
          ),

          // Style Selection
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(Text, { variant: 'sm', children: '显示样式' }),
            h(
              'div',
              {
                style: {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 10,
                },
              },
              STYLES.map((st) => {
                const isSelected = settings.style === st.id
                return h(
                  'button',
                  {
                    key: st.id,
                    type: 'button',
                    onClick: () => void updateSettings({ style: st.id }),
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '12px 14px',
                      borderRadius: 8,
                      border: isSelected
                        ? '1px solid var(--primary, #6366F1)'
                        : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                      background: isSelected
                        ? 'var(--surface-selected, rgba(99, 102, 241, 0.12))'
                        : 'rgba(255, 255, 255, 0.03)',
                      color: isSelected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-tertiary, #8E8E93)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                      gap: 4,
                    },
                  },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    tablerIcon(st.icon as 'chart-bar' | 'wave-sine', { size: 16 }),
                    h(Text, {
                      variant: isSelected ? 'md' : 'sm',
                      children: st.label,
                    }),
                  ),
                  h(Text, { variant: 'xs', tone: 'muted', children: st.desc }),
                )
              }),
            ),
          ),

          // Color Theme Selection
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(Text, { variant: 'sm', children: '色彩主题' }),
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                },
              },
              THEMES.map((theme) => {
                const isSelected = settings.colorTheme === theme.id
                return h(
                  'button',
                  {
                    key: theme.id,
                    type: 'button',
                    onClick: () => void updateSettings({ colorTheme: theme.id }),
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: isSelected
                        ? '1px solid var(--primary, #6366F1)'
                        : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                      background: isSelected
                        ? 'var(--surface-selected, rgba(99, 102, 241, 0.12))'
                        : 'rgba(255, 255, 255, 0.03)',
                      color: isSelected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-tertiary, #8E8E93)',
                      cursor: 'pointer',
                    },
                  },
                  h('div', {
                    style: {
                      width: 14,
                      height: 14,
                      borderRadius: tokens.radius.pill,
                      background: theme.color,
                    },
                  }),
                  h(Text, { variant: 'sm', children: theme.label }),
                )
              }),
            ),
          ),

          // Sensitivity Slider
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              h(Text, { variant: 'sm', children: '幅度灵敏度' }),
              h(Text, {
                variant: 'xs',
                tone: 'muted',
                children: `${Math.round((settings.sensitivity ?? 1) * 100)}%`,
              }),
            ),
            h(Slider, {
              value: Math.round((settings.sensitivity ?? 1) * 100),
              max: 200,
              accessibilityLabel: '幅度灵敏度',
              onChange: (val) => {
                const sensitivity = Math.max(0.5, Math.min(2.0, Math.round(val) / 100))
                void updateSettings({ sensitivity })
              },
            }),
          ),
        )
      : null,
  )
}
