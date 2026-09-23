import { createElement as h, useEffect, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { tokens } from '@BBeBee/ui-tokens'
import type { ListProps } from '@BBeBee/ui-core'
import { common } from '../theme.js'

export function List<T>(props: ListProps<T>) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const count = props.items.length
  const estimate = props.estimatedItemSize ?? tokens.size.row

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimate,
    overscan: 8,
  })

  const rows = virtualizer.getVirtualItems()

  const last = rows[rows.length - 1]
  const reachedEnd = last !== undefined && last.index >= count - 1
  const firedFor = useRef(-1)
  const onEndReached = props.onEndReached
  useEffect(() => {
    if (!reachedEnd || !onEndReached || firedFor.current === count) return
    firedFor.current = count
    onEndReached()
  }, [reachedEnd, onEndReached, count])

  if (count === 0 && props.empty !== undefined) {
    return h('div', common(props), props.empty as ReactNode)
  }

  return h(
    'div',
    {
      ...common(props),
      ref: scroller,
      role: 'list',
      style: { overflowY: 'auto', height: '100%' },
    },
    h(
      'div',
      { style: { height: virtualizer.getTotalSize(), position: 'relative', width: '100%' } },
      rows.map((row) => {
        const item = props.items[row.index]!
        return h(
          'div',
          {
            key: props.keyExtractor(item, row.index),
            role: 'listitem',
            'aria-setsize': count,
            'aria-posinset': row.index + 1,
            ref: virtualizer.measureElement,
            'data-index': row.index,
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${row.start}px)`,
            },
          },
          props.renderItem(item, row.index) as ReactNode,
        )
      }),
    ),
  )
}
