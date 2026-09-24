import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, EffectParamValue, OutputDevice, UiService } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import { Button, Slider } from '@BBeBee/ui-kit-desktop'
import { Select } from '../Select.js'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'
import { Switch } from '../Switch.js'

export function PlaybackSection({
  ctx,
  settings,
  update,
  chain,
  latencyMs,
  setEnabled,
  applyPreset,
  getParams,
  setParam,
}: {
  ctx: Context
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<unknown>
  chain: readonly { effectId: string; enabled: boolean }[]
  latencyMs: number
  setEnabled: (effectId: string, enabled: boolean) => Promise<void>
  applyPreset: (effectId: string, presetId: string) => Promise<void>
  getParams: (effectId: string) => Record<string, unknown>
  setParam: (effectId: string, key: string, value: EffectParamValue) => Promise<void>
}): ReactElement {
  const [crossfadeExpanded, setCrossfadeExpanded] = useState(true)
  const [eqExpanded, setEqExpanded] = useState(true)
  const [normExpanded, setNormExpanded] = useState(true)
  const [compExpanded, setCompExpanded] = useState(true)
  const [reverbExpanded, setReverbExpanded] = useState(true)
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([])

  useEffect(() => {
    let mounted = true
    const fetchDevices = async () => {
      try {
        const list = await ctx.audio?.listOutputDevices?.()
        if (mounted && Array.isArray(list) && list.length > 0) {
          setOutputDevices(list)
        }
      } catch {
        // fallback
      }
    }
    void fetchDevices()

    const media = (globalThis as {
      navigator?: { mediaDevices?: { addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void } }
    }).navigator?.mediaDevices

    if (media?.addEventListener && media?.removeEventListener) {
      media.addEventListener('devicechange', fetchDevices)
      return () => {
        mounted = false
        media.removeEventListener?.('devicechange', fetchDevices)
      }
    }
    return () => {
      mounted = false
    }
  }, [ctx])

  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const normEntry = chain.find((c) => c.effectId === 'normalize')
  const compEntry = chain.find((c) => c.effectId === 'compressor')
  const reverbEntry = chain.find((c) => c.effectId === 'reverb')

  const normParams = getParams('normalize')
  const compParams = getParams('compressor')
  const reverbParams = getParams('reverb')

  const VisualizerSettingsView = useServiceState(ctx, ['ui/changed'], () => {
    return (ctx.ui?.viewFor?.('visualizer.settings') as React.ComponentType<{ ctx: Context }> | undefined) ?? null
  })

  const currentEngine = settings.audioOutputEngine ?? 'wasapi'
  const currentDeviceId = settings.audioOutputDeviceId ?? 'default'

  const deviceOptions = (outputDevices.length > 0
    ? outputDevices
    : [{ id: 'default', label: '系统默认音频设备 (System Default)', isDefault: true }]
  ).map((d) => ({
    value: d.id,
    label: d.label || (d.id === 'default' ? '系统默认音频设备 (System Default)' : `音频设备 (${d.id.slice(0, 8)})`),
  }))

  // Ensure currentDeviceId is included in options so Select always renders a valid selection
  if (!deviceOptions.some((o) => o.value === currentDeviceId)) {
    deviceOptions.unshift({
      value: currentDeviceId,
      label: currentDeviceId === 'default' ? '系统默认音频设备 (System Default)' : `指定设备 (${currentDeviceId})`,
    })
  }

  return h(
    'div',
    { id: 'section-playback' },
    h(
      SettingsSection,
      {
        title: '音频输出引擎与设备',
        description: '选择音频驱动与输出方式：操作系统共享混音或硬件独占直出',
      },
      h(SettingsRow, {
        title: '音频输出驱动 (Audio Backend)',
        description:
          currentEngine === 'wasapi'
            ? '当前：WASAPI 硬件独占 Hi-Res（点对点无损输出，绕过系统混音器，保留 Web Audio DSP）'
            : '当前：WebAudio（通过操作系统共享混音器输出，多软件混音兼容）',
        action: h(
          'div',
          { style: { display: 'flex', gap: 6 } },
          h(Button, {
            variant: currentEngine === 'wasapi' ? 'primary' : 'secondary',
            onPress: () => {
              void update({ audioOutputEngine: 'wasapi' })
            },
            children: 'WASAPI 独占 Hi-Res',
          }),
          h(Button, {
            variant: currentEngine === 'webaudio' ? 'primary' : 'secondary',
            onPress: () => {
              void update({ audioOutputEngine: 'webaudio' })
            },
            children: 'WebAudio',
          }),
        ),
      }),
      h(SettingsRow, {
        title: '音频输出设备 (Output Device)',
        description: '选择播放器音频输出的硬件声卡终端、扬声器或外接 DAC',
        action: h(Select, {
          value: currentDeviceId,
          options: deviceOptions,
          accessibilityLabel: '音频输出设备',
          onChange: (newDeviceId: string) => {
            void update({ audioOutputDeviceId: newDeviceId })
            void ctx.audio?.setOutputDevice?.(newDeviceId)
          },
        }),
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
      h(SettingsRow, {
        title: '高级效果器调音与编排',
        description: `当前效果链包含 ${chain.length} 个处理节点，延迟: ${latencyMs}ms`,
        borderBottom: false,
        action: h(Button, {
          children: '打开音效面板 →',
          onPress: () => {
            serviceOf<UiService>(ctx, 'ui')?.navigate?.('dsp.view')
          },
        }),
      }),
    ),
    VisualizerSettingsView
      ? h(
          SettingsSection,
          {
            title: '音频可视化',
            description: '在播放界面呈现音乐频率跳动与声波流动效果，自定义显示样式与色彩',
          },
          h(VisualizerSettingsView, { ctx }),
        )
      : null,
    h(
      SettingsSection,
      {
        title: '播放历史与听歌记录',
        description: '查看历史听歌轨迹、播放次数统计与活跃热力图分布',
      },
      h(SettingsRow, {
        title: '播放历史 (Playback History)',
        description: '查看已播放曲目记录、按日期分布的听歌热力图及统计分析',
        borderBottom: false,
        action: h(Button, {
          children: '查看播放历史',
          onPress: () => {
            serviceOf<UiService>(ctx, 'ui')?.navigate?.('history.view')
          },
        }),
      }),
    ),
  )
}
