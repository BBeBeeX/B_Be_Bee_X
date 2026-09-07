/**
 * Test helpers for anything that renders a `List`.
 *
 * `List` windows its rows with `@tanstack/react-virtual`, which decides what
 * to render from how tall the scroller is. jsdom lays nothing out, so without
 * a size the virtualiser measures zero and renders an empty window — and every
 * test that counted rows would fail for a reason that has nothing to do with
 * what it was testing.
 *
 * This lives here rather than in each view package's tests because there is
 * one virtualiser and it should be faked once. Not shipped: `publishConfig`
 * exports only the kit itself.
 */

/** Row height the stub reports, matching `tokens.size.row`. */
export const TEST_ROW_HEIGHT = 56
/** Scroller height the stub reports — a few rows plus the overscan. */
export const TEST_VIEWPORT_HEIGHT = 400

/**
 * Run `body` with every element reporting a size.
 *
 * `offsetHeight`/`offsetWidth` specifically: those are what the virtualiser
 * measures with, and a stub on `getBoundingClientRect` alone leaves it reading
 * zero. The scroller — the element carrying `role="list"` — gets the viewport
 * height and everything else gets a row's.
 *
 * The descriptors are restored afterwards, including the case where jsdom had
 * none to begin with, so one test cannot leave a size behind for the next.
 */
export function withListLayout<T>(body: () => T): T {
  const names = ['offsetHeight', 'offsetWidth'] as const
  const saved = names.map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  )

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('role') === 'list' ? TEST_VIEWPORT_HEIGHT : TEST_ROW_HEIGHT
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 300,
  })

  let done = false
  const restore = () => {
    if (done) return
    done = true
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, name)
    }
  }

  try {
    const out = body()
    /*
     * An async body keeps the sizes until it settles.
     *
     * The virtualiser measures in a layout effect and re-renders, so anything
     * that renders and *then* awaits — a screen fetching its rows — does its
     * real measuring after the synchronous part returns. Restoring at that
     * point left the second pass measuring zero and rendering an empty window,
     * which reads as "the list is broken" rather than "the helper returned
     * too early".
     */
    if (isThenable(out)) {
      return out.then(
        (value: unknown) => {
          restore()
          return value
        },
        (error: unknown) => {
          restore()
          throw error
        },
      ) as T
    }
    restore()
    return out
  } catch (error) {
    restore()
    throw error
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  )
}
