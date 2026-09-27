import { createElement as h, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { tokens } from '@BBeBee/ui-tokens'
import type { ListProps } from '@BBeBee/ui-core'
import { common } from '../theme.js'

export function List<T>(props: ListProps<T>) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const count = props.items.length
  const estimate = props.estimatedItemSize ?? tokens.size.row

  // A header scrolls inside the scroller above the rows, so the virtualiser
  // must treat the first row as starting below it — `scrollMargin`, measured
  // off the real header box, since a wrapped title or an optional toolbar
  // makes the height unknowable from props.
  const [headerHeight, setHeaderHeight] = useState(0)
  const hasHeader = props.header !== undefined

  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el || !hasHeader) {
      setHeaderHeight((prev) => (prev === 0 ? prev : 0))
      return
    }
    const measure = () => {
      const height = Math.round(el.getBoundingClientRect().height)
      setHeaderHeight((prev) => (prev === height ? prev : height))
    }
    measure()
    // jsdom (and some embedded webviews) ship no ResizeObserver; a missing
    // one costs only live re-measurement — the mount-time measure above
    // already covers the static case.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasHeader])

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimate,
    overscan: 8,
    scrollMargin: headerHeight,
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

  const onScroll = props.onScroll
  const handleScroll = (event: { currentTarget: { scrollTop: number } }) => {
    onScroll?.(event.currentTarget.scrollTop)
  }

  const isEmpty = count === 0 && props.empty !== undefined

  return h(
    'div',
    {
      ...common(props),
      ref: scroller,
      role: 'list',
      onScroll: onScroll ? handleScroll : undefined,
      style: { overflowY: 'auto', overflowX: 'hidden', height: '100%' },
    },
    // The pinned bar has to be the scroller's own child: a sticky element
    // only sticks within its parent's box, so nesting it inside the header
    // would let it scroll away exactly when it has finished arriving.
    (props.sticky ?? null) as ReactNode,
    hasHeader ? h('div', { ref: headerRef }, props.header as ReactNode) : null,
    isEmpty
      ? (props.empty as ReactNode)
      : h(
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
                  transform: `translateY(${row.start - headerHeight}px)`,
                },
              },
              props.renderItem(item, row.index) as ReactNode,
            )
          }),
        ),
  )
}
