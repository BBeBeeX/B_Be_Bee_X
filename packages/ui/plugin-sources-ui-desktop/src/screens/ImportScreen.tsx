import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ImportReport } from '@BBeBee/protocol'
import { useSourceImport } from '@BBeBee/plugin-sources/hooks'
import { Button, Text, TextField } from '@BBeBee/ui-kit-desktop'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

export function ImportScreen({ ctx }: { ctx: Context }): ReactElement {
  const state = useSourceImport(ctx)
  const scheme = p()

  return h(
    'section',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Import a source'),
    h(
      Text,
      { variant: 'sm', tone: 'muted' },
      'Paste a source string — one document or a whole set. Nothing is written until you import.',
    ),
    h(TextField, {
      value: state.text,
      onChange: state.setText,
      multiline: true,
      rows: 14,
      placeholder: '{ "sourceUrl": "https://…", "sourceName": "…", "ruleStream": { … } }',
      accessibilityLabel: 'Source string',
      testID: 'source-import-input',
      ...(state.issues.length > 0
        ? { error: state.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n') }
        : {}),
    }),
    state.preview
      ? h(
          'ul',
          {
            style: {
              margin: 0,
              padding: tokens.space[3],
              borderRadius: tokens.radius.sm,
              background: scheme.bg.raised,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[1],
            },
            'aria-label': 'What will be imported',
          },
          h(
            Text,
            { variant: 'sm', tone: 'muted' },
            `${state.preview.count} source${state.preview.count === 1 ? '' : 's'} in this string`,
          ),
          ...state.preview.names.map((name) => h('li', { key: name }, h(Text, { variant: 'sm' }, name))),
        )
      : null,
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2] } },
      h(Button, {
        onPress: state.submit,
        disabled: state.busy || !state.preview,
        loading: state.busy,
        testID: 'source-import-submit',
        children: 'Import',
      }),
      h(Button, {
        variant: 'ghost',
        onPress: state.reset,
        disabled: state.busy,
        children: 'Clear',
      }),
    ),
    state.report
      ? h(
          Text,
          { variant: 'sm', tone: state.report.added.length + state.report.updated.length > 0 ? 'accent' : 'muted' },
          summariseImport(state.report),
        )
      : null,
  )
}

function summariseImport(report: ImportReport): string {
  const parts: string[] = []
  if (report.added.length) parts.push(`${report.added.length} added`)
  if (report.updated.length) parts.push(`${report.updated.length} updated`)
  if (report.unchanged.length) parts.push(`${report.unchanged.length} unchanged`)
  if (report.rejected.length) parts.push(`${report.rejected.length} rejected`)
  return parts.length > 0 ? parts.join(', ') : 'nothing to import'
}
