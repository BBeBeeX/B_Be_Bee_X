import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { Button } from '@BBeBee/ui-kit-desktop'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface SourcesSectionProps {
  onNavigate: (route: string) => void
}

export function SourcesSection({ onNavigate }: SourcesSectionProps): ReactElement {
  return h(
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
        description: '查看已启用的网络音源、进行源能力健康诊断或管理第三方音源列表',
        action: h(Button, {
          children: '管理音乐源',
          onPress: () => onNavigate('sources.settings'),
        }),
      }),
      h(SettingsRow, {
        title: '导入音源 (Import Sources)',
        description: '从剪贴板文本、本地 JSON 规则文件或网络 URL 导入第三方音源脚本 (Legado 格式)',
        action: h(Button, {
          children: '导入音源',
          onPress: () => onNavigate('sources.import'),
        }),
      }),
      h(SettingsRow, {
        title: '本地音乐文件夹 (Music Folders)',
        description: '添加包含本地音频文件的文件夹，即时执行扫描并建立索引',
        borderBottom: false,
        action: h(Button, {
          children: '管理文件夹',
          onPress: () => onNavigate('scanner.settings'),
        }),
      }),
    ),
  )
}
