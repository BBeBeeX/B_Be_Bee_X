/**
 * The parity gate, checked against itself.
 *
 * The kits do not exist yet — docs/11 §4.11 puts this test *before* the first
 * screen deliberately, because building screens first and infrastructure
 * later means writing the screens twice. So these run against fake kits: what
 * is being tested is that the gate catches each way the real kits will drift.
 */

import { describe, expect, it } from 'vitest'
import {
  COMPONENT_CONTRACT,
  COMPONENT_NAMES,
  checkParity,
  formatProblems,
  requiredProps,
  specFor,
  type KitExports,
} from './index.js'

/** A kit that satisfies the contract exactly. */
function completeKit(): KitExports {
  return Object.fromEntries(COMPONENT_NAMES.map((name) => [name, () => null]))
}

/** Props declared exactly as the contract asks. */
function completeProps() {
  return Object.fromEntries(
    COMPONENT_CONTRACT.map((c) => [c.name, c.props.map((p) => p.name)]),
  )
}

describe('the contract itself', () => {
  it('names every component once', () => {
    expect(new Set(COMPONENT_NAMES).size).toBe(COMPONENT_NAMES.length)
  })

  it('gives every component a purpose and at least one prop', () => {
    // A component with no stated purpose is one nobody can decide whether to
    // add to — and the contract commits someone to writing it twice.
    for (const spec of COMPONENT_CONTRACT) {
      expect(spec.purpose.length, spec.name).toBeGreaterThan(10)
      expect(spec.props.length, spec.name).toBeGreaterThan(0)
    }
  })

  it('names every prop of a component once', () => {
    for (const spec of COMPONENT_CONTRACT) {
      const names = spec.props.map((p) => p.name)
      expect(new Set(names).size, spec.name).toBe(names.length)
    }
  })

  it('requires an accessible name on the component that has no text', () => {
    // docs/08 §8: an icon-only control has nothing to fall back on.
    expect(requiredProps('IconButton')).toContain('accessibilityLabel')
    expect(specFor('Button')?.props.map((p) => p.name)).toContain('accessibilityLabel')
  })

  it('uses one event-prop name across the set', () => {
    // `onPress` on one kit and `onClick` on the other is the drift that costs
    // every plugin author, forever, in both packages.
    const handlers = COMPONENT_CONTRACT.flatMap((c) =>
      c.props.map((p) => p.name).filter((n) => n.startsWith('on')),
    )
    expect(handlers).not.toContain('onClick')
    expect(handlers).toContain('onPress')
  })
})

describe('the gate', () => {
  it('passes two kits that match', () => {
    const problems = checkParity({
      desktop: completeKit(),
      mobile: completeKit(),
      desktopProps: completeProps(),
      mobileProps: completeProps(),
    })
    expect(problems, formatProblems(problems)).toEqual([])
  })

  it('catches a component missing from one kit', () => {
    const mobile = completeKit()
    delete mobile.Toast
    const problems = checkParity({ desktop: completeKit(), mobile })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ kind: 'missing' })
    expect(problems[0]!.detail).toContain('mobile does not export Toast')
  })

  it('catches a component only one kit has', () => {
    // The dangerous direction: a plugin author finds it, uses it, and the
    // feature is silently desktop-only.
    const desktop = { ...completeKit(), ContextMenu: () => null }
    const problems = checkParity({ desktop, mobile: completeKit() })
    expect(problems.map((p) => p.kind)).toEqual(['extra'])
    expect(problems[0]!.detail).toContain('ContextMenu')
  })

  it('ignores non-component exports', () => {
    // A kit may export helpers and types; only capitalised names are held to
    // the contract.
    const desktop = { ...completeKit(), useTheme: () => null, tokens: {} }
    expect(checkParity({ desktop, mobile: completeKit() })).toEqual([])
  })

  it('catches something exported under a component name that is not one', () => {
    const desktop = { ...completeKit(), Button: 'a string' }
    const problems = checkParity({ desktop, mobile: completeKit() })
    expect(problems[0]).toMatchObject({ kind: 'not-a-component' })
  })

  it('catches a prop one kit does not accept', () => {
    const props = completeProps()
    props.Slider = props.Slider!.filter((p) => p !== 'onCommit')
    const problems = checkParity({
      desktop: completeKit(),
      mobile: completeKit(),
      desktopProps: completeProps(),
      mobileProps: props,
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]!.detail).toContain('mobile.Slider does not accept "onCommit"')
    // The note travels with the failure, so the fix is obvious.
    expect(problems[0]!.detail).toContain('every frame of a drag')
  })

  it('checks palette contrast as part of the same gate', () => {
    // docs/11 §4.11 puts contrast here rather than in a separate suite, so one
    // CI job answers "are the two view layers still one product".
    const problems = checkParity({ desktop: completeKit(), mobile: completeKit() })
    expect(problems.filter((p) => p.kind === 'contrast')).toEqual([])
  })

  it('formats problems so a CI log can be read', () => {
    const mobile = completeKit()
    delete mobile.List
    const message = formatProblems(checkParity({ desktop: completeKit(), mobile }))
    expect(message).toContain('[missing]')
    expect(message).toContain('List')
  })

  it('says so plainly when there is nothing wrong', () => {
    expect(formatProblems([])).toBe('kits are in parity')
  })
})
