import { createElement as h, Fragment, useEffect, useState } from 'react'
import type React from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { ContextMenuProps, MenuItemSpec } from '@BBeBee/ui-core'
import { c, common, useHover } from '../theme.js'
import { Button } from './Button.js'
import { Text } from './Text.js'
import { TextField } from './TextField.js'

const MENU_WIDTH = 248

export function ContextMenu(props: ContextMenuProps): ReactElement | null {
  const [submenuState, setSubmenuState] = useState<
    { id: string; rect?: { top: number; right: number; bottom: number; left: number } } | undefined
  >(undefined)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const p = c()

  useEffect(() => {
    if (props.open) return
    setSubmenuState(undefined)
    setFilter('')
    setCreating(false)
    setDraft('')
  }, [props.open])

  if (!props.open) return null

  const submenu = props.items.find((item) => item.id === submenuState?.id)?.submenu
  const needle = filter.trim().toLowerCase()
  const visible = submenu
    ? submenu.items.filter((item) => item.label.toLowerCase().includes(needle))
    : []

  const close = () => props.onClose()
  const activate = (item: MenuItemSpec) => {
    if (item.disabled) return
    if (item.submenu) {
      setSubmenuState((prev) => (prev?.id === item.id ? prev : { id: item.id }))
      return
    }
    void item.onSelect?.()
    close()
  }

  const width = MENU_WIDTH
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
  const left = Math.max(8, Math.min(props.x, viewportWidth - width - 8))
  const top = Math.max(8, Math.min(props.y, Math.max(8, viewportHeight - 240)))

  let flyoutLeft: number
  let flyoutTop: number
  if (submenuState?.rect && (submenuState.rect.right > 0 || submenuState.rect.left > 0)) {
    const r = submenuState.rect
    if (r.right + width + 8 <= viewportWidth) {
      flyoutLeft = r.right + 2
    } else if (r.left - width - 2 >= 8) {
      flyoutLeft = r.left - width - 2
    } else {
      flyoutLeft = Math.max(8, viewportWidth - width - 8)
    }
    flyoutTop = Math.max(8, Math.min(r.top, viewportHeight - 240))
  } else {
    if (left + width + width + 8 <= viewportWidth) {
      flyoutLeft = left + width + 2
    } else if (left - width - 2 >= 8) {
      flyoutLeft = left - width - 2
    } else {
      flyoutLeft = Math.max(8, viewportWidth - width - 8)
    }
    flyoutTop = top
  }

  return h(
    'div',
    {
      role: 'presentation',
      onClick: close,
      onContextMenu: (event: { preventDefault(): void }) => {
        event.preventDefault()
        close()
      },
      style: { position: 'fixed', inset: 0, zIndex: tokens.z.overlay },
    },
    h(
      'div',
      {
        role: 'menu',
        ...common(props),
        'aria-label': props.accessibilityLabel ?? props.title ?? 'Actions',
        onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Escape') close()
        },
        style: {
          position: 'fixed',
          left,
          top,
          width,
          maxHeight: '70vh',
          overflowY: 'auto',
          padding: 4,
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          background: '#242424',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
        },
      },
      props.title
        ? h(
            'div',
            { style: { padding: '6px 12px 4px 12px' } },
            h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: props.title }),
          )
        : null,
      props.items.map((item) =>
        h(
          Fragment,
          { key: item.id },
          h(MenuRow, {
            item,
            active: submenuState?.id === item.id,
            onActivate: activate,
            onHover: (rect) => {
              if (item.submenu) {
                if (submenuState?.id !== item.id) {
                  setSubmenuState({ id: item.id, rect })
                  setFilter('')
                  setCreating(false)
                  setDraft('')
                }
              } else {
                setSubmenuState(undefined)
                setFilter('')
                setCreating(false)
                setDraft('')
              }
            },
          }),
          item.divider
            ? h('div', {
                key: `${item.id}-divider`,
                style: {
                  height: 1,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  margin: '4px 6px',
                },
              })
            : null,
        ),
      ),
    ),
    submenu
      ? h(
          'div',
          {
            role: 'menu',
            'aria-label': submenu.title ?? 'Submenu',
            onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
            style: {
              position: 'fixed',
              left: flyoutLeft,
              top: flyoutTop,
              width,
              maxHeight: '70vh',
              overflowY: 'auto',
              padding: 4,
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              background: '#242424',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
              zIndex: tokens.z.overlay + 1,
            },
          },
          submenu.title
            ? h(
                'div',
                { style: { padding: '6px 12px 4px 12px' } },
                h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: submenu.title }),
              )
            : null,
          submenu.searchPlaceholder
            ? h(
                'div',
                { style: { padding: `0 ${tokens.space[2]}px ${tokens.space[2]}px` } },
                h(TextField, {
                  value: filter,
                  onChange: setFilter,
                  placeholder: submenu.searchPlaceholder,
                  testID: 'context-menu-filter',
                }),
              )
            : null,
          (() => {
            const isCreateBottom = submenu.create?.placement === 'bottom'
            const createRow = submenu.create
              ? creating || submenu.create.alwaysVisible
                ? h(
                    'div',
                    {
                      key: '__create-field',
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: tokens.space[2],
                        padding: `${tokens.space[2]}px ${tokens.space[2]}px`,
                        borderTop: isCreateBottom ? `1px solid ${p.border.subtle}` : undefined,
                        borderBottom: !isCreateBottom ? `1px solid ${p.border.subtle}` : undefined,
                        marginTop: isCreateBottom ? tokens.space[1] : 0,
                        marginBottom: !isCreateBottom ? tokens.space[1] : 0,
                      },
                      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation()
                          const name = draft.trim()
                          if (!name) return
                          void submenu.create?.onSelect(name)
                          close()
                        }
                      },
                    },
                    h(
                      'div',
                      { style: { flex: 1, minWidth: 0 } },
                      h(TextField, {
                        value: draft,
                        onChange: setDraft,
                        placeholder: submenu.create.placeholder,
                        testID: 'context-menu-create-name',
                      }),
                    ),
                    h(Button, {
                      onPress: () => {
                        const name = draft.trim()
                        if (!name) return
                        void submenu.create?.onSelect(name)
                        close()
                      },
                      disabled: draft.trim().length === 0,
                      testID: 'context-menu-create-confirm',
                      children: submenu.create.buttonLabel ?? '确定',
                    }),
                  )
                : h(MenuRow, {
                    key: '__create',
                    item: { id: '__create', label: submenu.create.label, icon: '＋' },
                    onActivate: () => setCreating(true),
                  })
              : null

            const itemRows =
              visible.length === 0
                ? [
                    h(
                      'div',
                      { key: '__empty', style: { padding: tokens.space[3] } },
                      h(Text, { variant: 'sm', tone: 'muted', children: submenu.emptyLabel ?? 'No matches' }),
                    ),
                  ]
                : visible.map((item) =>
                    h(
                      Fragment,
                      { key: item.id },
                      h(MenuRow, { key: item.id, item, onActivate: activate }),
                      item.divider
                        ? h('div', {
                            key: `${item.id}-divider`,
                            style: {
                              height: 1,
                              backgroundColor: 'rgba(255, 255, 255, 0.08)',
                              margin: '4px 6px',
                            },
                          })
                        : null,
                    ),
                  )

            return h(
              Fragment,
              null,
              !isCreateBottom ? createRow : null,
              itemRows,
              isCreateBottom ? createRow : null,
            )
          })(),
        )
      : null,
  )
}

function renderMenuIcon(icon: React.ReactNode | string | undefined): React.ReactNode {
  if (!icon) {
    return h('span', { 'aria-hidden': true, style: { width: 18, height: 18, display: 'inline-block' } })
  }
  if (typeof icon !== 'string') {
    return h(
      'span',
      {
        'aria-hidden': true,
        style: {
          width: 18,
          height: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        },
      },
      icon,
    )
  }

  const strokeProps = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  let svgElement: React.ReactNode

  if (icon === 'pencil' || icon === 'rename' || icon === 'edit' || icon === '✎' || icon === '✏') {
    svgElement = h(
      'svg',
      strokeProps,
      h('path', { d: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z' }),
    )
  } else if (icon === 'delete' || icon === 'remove' || icon === '－' || icon === '⊝') {
    svgElement = h(
      'svg',
      strokeProps,
      h('circle', { cx: 12, cy: 12, r: 10 }),
      h('line', { x1: 8, y1: 12, x2: 16, y2: 12 }),
    )
  } else if (icon === 'pin' || icon === '📌' || icon === 'unpin') {
    svgElement = h(
      'svg',
      strokeProps,
      h('line', { x1: 12, y1: 17, x2: 12, y2: 22 }),
      h('path', { d: 'M5 17h14v-2l-2-2V5h1V3H6v2h1v8l-2 2v2z' }),
    )
  } else if (icon === 'create-playlist' || icon === 'music-plus') {
    svgElement = h(
      'svg',
      strokeProps,
      h('path', { d: 'M9 18V5l12-2v13' }),
      h('circle', { cx: 6, cy: 18, r: 3 }),
      h('circle', { cx: 18, cy: 16, r: 3 }),
      h('line', { x1: 1, y1: 8, x2: 7, y2: 8 }),
      h('line', { x1: 4, y1: 5, x2: 4, y2: 11 }),
    )
  } else if (icon === 'create-folder' || icon === 'plus' || icon === '＋') {
    svgElement = h(
      'svg',
      strokeProps,
      h('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
      h('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
    )
  } else if (icon === 'folder' || icon === '📁' || icon === '🗂') {
    svgElement = h(
      'svg',
      strokeProps,
      h('path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }),
    )
  } else if (icon === 'play' || icon === '▶') {
    svgElement = h(
      'svg',
      { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor' },
      h('polygon', { points: '6 4 20 12 6 20 6 4' }),
    )
  } else if (icon === 'download' || icon === '⬇') {
    svgElement = h(
      'svg',
      strokeProps,
      h('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
      h('polyline', { points: '7 10 12 15 17 10' }),
      h('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
    )
  } else if (icon === 'playlist-add' || icon === '≡') {
    svgElement = h(
      'svg',
      strokeProps,
      h('line', { x1: 4, y1: 6, x2: 16, y2: 6 }),
      h('line', { x1: 4, y1: 12, x2: 14, y2: 12 }),
      h('line', { x1: 4, y1: 18, x2: 12, y2: 18 }),
      h('line', { x1: 18, y1: 13, x2: 18, y2: 19 }),
      h('line', { x1: 15, y1: 16, x2: 21, y2: 16 }),
    )
  } else {
    return h(
      'span',
      {
        'aria-hidden': true,
        style: {
          width: 18,
          height: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          flexShrink: 0,
        },
      },
      icon,
    )
  }

  return h(
    'span',
    {
      'aria-hidden': true,
      style: {
        width: 18,
        height: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: 'inherit',
      },
    },
    svgElement,
  )
}

function MenuRow({
  item,
  active,
  onActivate,
  onHover,
}: {
  item: MenuItemSpec
  active?: boolean
  onActivate: (item: MenuItemSpec) => void
  onHover?: (rect: { top: number; right: number; bottom: number; left: number }) => void
}): ReactElement {
  const [hovered, hoverProps] = useHover()
  const danger = item.tone === 'danger'
  return h(
    'button',
    {
      type: 'button',
      role: 'menuitem',
      disabled: item.disabled,
      'aria-haspopup': item.submenu ? 'menu' : undefined,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onHover?.({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left })
        onActivate(item)
      },
      onMouseEnter: (event: React.MouseEvent<HTMLButtonElement>) => {
        hoverProps.onMouseEnter?.()
        const rect = event.currentTarget.getBoundingClientRect()
        onHover?.({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left })
      },
      onMouseLeave: () => {
        hoverProps.onMouseLeave?.()
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        minHeight: 36,
        padding: '0 12px',
        margin: '1px 0',
        border: 'none',
        borderRadius: 6,
        textAlign: 'left',
        cursor: item.disabled ? 'default' : 'pointer',
        opacity: item.disabled ? 0.45 : 1,
        background: (hovered || active) && !item.disabled ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
        color: danger ? '#FF6B6B' : '#EDEDED',
        font: 'inherit',
        fontSize: '13.5px',
        outline: 'none',
        transition: 'background-color 100ms ease',
      },
    },
    renderMenuIcon(item.icon),
    h(
      'span',
      {
        style: {
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        },
      },
      item.label,
    ),
    item.submenu
      ? h(
          'span',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 10,
              height: 10,
              marginLeft: 'auto',
              color: 'rgba(255, 255, 255, 0.7)',
            },
          },
          h(
            'svg',
            { width: 8, height: 8, viewBox: '0 0 24 24', fill: 'currentColor' },
            h('polygon', { points: '8 5 19 12 8 19 8 5' }),
          ),
        )
      : null,
  )
}
