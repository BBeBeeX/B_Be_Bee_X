/**
 * Desktop DSP Chain Editor Screen for `@BBeBee/plugin-dsp`.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, Slider } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'
import { EQ10_BANDS } from '@BBeBee/plugin-dsp/effects'

export interface DspScreenProps {
  ctx: Context
}

function Switch({
  checked,
  onChange,
  disabled = false,
  accessibilityLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
}): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': accessibilityLabel,
      disabled,
      onClick: () => {
        if (!disabled) onChange(!checked)
      },
      style: {
        width: 40,
        height: 22,
        borderRadius: 11,
        background: checked ? '#39d353' : 'rgba(255, 255, 255, 0.15)',
        border: 'none',
        padding: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        transition: 'background-color 0.2s',
        opacity: disabled ? 0.5 : 1,
      },
    },
    h('div', {
      style: {
        width: 18,
        height: 18,
        borderRadius: 9,
        background: '#ffffff',
        transform: checked ? 'translateX(18px)' : 'translateX(0px)',
        transition: 'transform 0.2s',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
      },
    }),
  )
}

export function DspScreen({ ctx }: DspScreenProps): ReactElement {
  const { chain, definitions, latencyMs, setEnabled, setOrder, setParam, applyPreset, getParams } =
    useDsp(ctx)

  const [activeTab, setActiveTab] = useState<'eq' | 'chain'>('eq')

  const eqDef = definitions.find((d) => d.id === 'eq10')
  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const eqParams = getParams('eq10')
  const eqGains = (Array.isArray(eqParams.gains) ? eqParams.gains : EQ10_BANDS.map(() => 0)) as number[]

  const handleBandChange = (index: number, dbVal: number) => {
    const next = [...eqGains]
    next[index] = Math.round(dbVal)
    void setParam('eq10', `band${index}`, next[index]!)
  }

  const handleMoveUp = async (index: number) => {
    if (index <= 0) return
    const current = chain[index]
    const prev = chain[index - 1]
    if (current && prev) {
      const targetOrdinal = prev.ordinal
      await setOrder(current.effectId, targetOrdinal)
      await setOrder(prev.effectId, targetOrdinal + 1)
    }
  }

  const handleMoveDown = async (index: number) => {
    if (index >= chain.length - 1) return
    const current = chain[index]
    const next = chain[index + 1]
    if (current && next) {
      const targetOrdinal = next.ordinal
      await setOrder(current.effectId, targetOrdinal)
      await setOrder(next.effectId, targetOrdinal - 1)
    }
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        maxWidth: 1000,
        margin: '0 auto',
        padding: '24px 32px',
        gap: 20,
        color: '#f5f5f7',
      },
    },
    // Top Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: 16,
        },
      },
      h(
        'div',
        null,
        h('h1', { style: { fontSize: 24, fontWeight: 700, margin: 0 } }, '音频效果器与均衡器 (DSP)'),
        h(
          'p',
          { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.5)', margin: '4px 0 0' } },
          '配置实时音频效果链与 10 频段图示均衡器',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        h(
          'div',
          {
            style: {
              background: 'rgba(255, 255, 255, 0.08)',
              padding: '6px 12px',
              borderRadius: tokens.radius.sm,
              fontSize: 12,
              color: 'rgba(255, 255, 255, 0.7)',
            },
          },
          `处理延迟: ${latencyMs} ms`,
        ),
      ),
    ),

    // Sub Navigation Tabs
    h(
      'div',
      { style: { display: 'flex', gap: 8 } },
      h(
        'button',
        {
          type: 'button',
          onClick: () => setActiveTab('eq'),
          style: {
            padding: '8px 16px',
            borderRadius: tokens.radius.sm,
            border: 'none',
            background: activeTab === 'eq' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
            color: activeTab === 'eq' ? '#fff' : 'rgba(255, 255, 255, 0.6)',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
          },
        },
        '🎚️ 10 频段均衡器 (EQ)',
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () => setActiveTab('chain'),
          style: {
            padding: '8px 16px',
            borderRadius: tokens.radius.sm,
            border: 'none',
            background: activeTab === 'chain' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
            color: activeTab === 'chain' ? '#fff' : 'rgba(255, 255, 255, 0.6)',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
          },
        },
        '🔗 效果链编排 (Effect Chain)',
      ),
    ),

    // Tab 1: EQ Graphic Sliders & Presets
    activeTab === 'eq' &&
      h(
        'div',
        {
          style: {
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: tokens.radius.md,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          },
        },
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
            { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            h('span', { style: { fontWeight: 600, fontSize: 16 } }, '启用均衡器'),
            h(Switch, {
              checked: eqEntry?.enabled ?? false,
              accessibilityLabel: '启用 10 频段均衡器',
              onChange: (on) => void setEnabled('eq10', on),
            }),
          ),
          eqDef?.presets &&
            h(
              'div',
              { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              eqDef.presets.map((preset) =>
                h(
                  'button',
                  {
                    key: preset.name,
                    type: 'button',
                    onClick: () => void applyPreset('eq10', preset.name),
                    style: {
                      padding: '4px 10px',
                      borderRadius: tokens.radius.sm,
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: 'rgba(255, 255, 255, 0.85)',
                      fontSize: 12,
                      cursor: 'pointer',
                    },
                  },
                  preset.name,
                ),
              ),
            ),
        ),

        // 10 Frequency Sliders Grid
        h(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(10, 1fr)',
              gap: 12,
              paddingTop: 16,
              alignItems: 'end',
              textAlign: 'center',
            },
          },
          EQ10_BANDS.map((freq, idx) => {
            const gain = eqGains[idx] ?? 0
            const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`
            return h(
              'div',
              {
                key: freq,
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                },
              },
              h(
                'span',
                {
                  style: {
                    fontSize: 11,
                    color: gain !== 0 ? '#39d353' : 'rgba(255, 255, 255, 0.6)',
                    fontWeight: 600,
                  },
                },
                `${gain > 0 ? '+' : ''}${gain}dB`,
              ),
              h(
                'div',
                { style: { height: 160, display: 'flex', alignItems: 'center' } },
                h(Slider, {
                  value: gain + 12, // normalized 0..24
                  max: 24,
                  accessibilityLabel: `${label}Hz gain`,
                  onChange: (v) => handleBandChange(idx, v - 12),
                }),
              ),
              h('span', { style: { fontSize: 12, color: 'rgba(255, 255, 255, 0.7)' } }, label),
            )
          }),
        ),
      ),

    // Tab 2: Full Effect Chain List
    activeTab === 'chain' &&
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        chain.map((entry, index) => {
          const def = definitions.find((d) => d.id === entry.effectId)
          if (!def) return null
          const params = getParams(entry.effectId)

          return h(
            'div',
            {
              key: entry.effectId,
              style: {
                background: 'rgba(255, 255, 255, 0.04)',
                borderRadius: tokens.radius.md,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                border: entry.enabled ? '1px solid rgba(57, 211, 83, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
              },
            },
            // Card Header
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
                { style: { display: 'flex', alignItems: 'center', gap: 12 } },
                h(
                  'span',
                  {
                    style: {
                      fontSize: 12,
                      color: 'rgba(255, 255, 255, 0.4)',
                      background: 'rgba(255, 255, 255, 0.06)',
                      padding: '2px 6px',
                      borderRadius: 4,
                    },
                  },
                  `#${entry.ordinal}`,
                ),
                h('span', { style: { fontWeight: 600, fontSize: 15 } }, def.displayName),
                h(Switch, {
                  checked: entry.enabled,
                  accessibilityLabel: `启用 ${def.displayName}`,
                  onChange: (on) => void setEnabled(entry.effectId, on),
                }),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 6 } },
                h(Button, {
                  disabled: index === 0,
                  onPress: () => void handleMoveUp(index),
                  children: '↑ 上移',
                }),
                h(Button, {
                  disabled: index === chain.length - 1,
                  onPress: () => void handleMoveDown(index),
                  children: '↓ 下移',
                }),
              ),
            ),

            // Effect-Specific Controls
            entry.effectId === 'preamp' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `增益: ${params.gainDb ?? 0} dB`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: (Number(params.gainDb ?? 0)) + 20,
                    max: 40,
                    accessibilityLabel: '前级增益',
                    onChange: (v) => void setParam('preamp', 'gainDb', Math.round(v - 20)),
                  }),
                ),
              ),

            entry.effectId === 'normalize' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `增益微调: ${params.gainDb ?? 0} dB`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: (Number(params.gainDb ?? 0)) + 12,
                    max: 24,
                    accessibilityLabel: '标准化增益',
                    onChange: (v) => void setParam('normalize', 'gainDb', Math.round(v - 12)),
                  }),
                ),
                def.presets &&
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6 } },
                    def.presets.map((preset) =>
                      h(Button, {
                        key: preset.name,
                        variant: 'secondary',
                        onPress: () => void applyPreset('normalize', preset.name),
                        children: preset.name.split(' ')[0] ?? preset.name,
                      }),
                    ),
                  ),
              ),

            entry.effectId === 'compressor' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `阈值: ${params.threshold ?? -24} dB`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: (Number(params.threshold ?? -24)) + 60,
                    max: 60,
                    accessibilityLabel: '压缩阈值',
                    onChange: (v) => void setParam('compressor', 'threshold', Math.round(v - 60)),
                  }),
                ),
                def.presets &&
                  h(Button, {
                    onPress: () => void applyPreset('compressor', '夜间模式 (Night Mode)'),
                    children: '🌙 夜间模式',
                  }),
              ),

            entry.effectId === 'reverb' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `混响比例: ${Math.round((Number(params.mix ?? 0.25)) * 100)}%`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Math.round((Number(params.mix ?? 0.25)) * 100),
                    max: 100,
                    accessibilityLabel: '混响比例',
                    onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
                  }),
                ),
              ),

            entry.effectId === 'widener' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `立体声宽度: ${Number(params.width ?? 1.2).toFixed(1)}x`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Math.round((Number(params.width ?? 1.2)) * 50),
                    max: 100,
                    accessibilityLabel: '立体声宽度',
                    onChange: (v) => void setParam('widener', 'width', Math.round(v) / 50),
                  }),
                ),
                h(
                  'span',
                  { style: { fontSize: 12, color: 'rgba(255, 200, 50, 0.8)' } },
                  '⚠️ 过度展宽可能降低单声道兼容性',
                ),
              ),

            entry.effectId === 'crossfeed' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `馈入量: ${Math.round((Number(params.amount ?? 0.35)) * 100)}%`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Math.round((Number(params.amount ?? 0.35)) * 100),
                    max: 100,
                    accessibilityLabel: '耳机交叉馈入量',
                    onChange: (v) => void setParam('crossfeed', 'amount', Math.round(v) / 100),
                  }),
                ),
              ),

            entry.effectId === 'limiter' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `上限阈值: ${params.ceilingDb ?? -0.5} dB`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Math.round(((Number(params.ceilingDb ?? -0.5)) + 12) * 8.33),
                    max: 100,
                    accessibilityLabel: '限制器上限',
                    onChange: (v) => void setParam('limiter', 'ceilingDb', -Math.round((100 - v) / 8.33 * 10) / 10),
                  }),
                ),
              ),
          )
        }),
      ),
  )
}
