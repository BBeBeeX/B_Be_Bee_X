/**
 * `@BBeBee/ui-parity` — the check that keeps ADR-2 affordable.
 *
 * Two kits, no shared component code, one product. Without a gate the kits
 * drift: a prop renamed on one side, a component that exists on only one, a
 * palette that is readable in one scheme. Each of those is cheap to fix the
 * week it happens and expensive a year later, because by then every plugin
 * author has written around it.
 *
 * See docs/08 §6 and docs/11 §4.11.
 */

import { paletteContrastIssues } from '@BBeBee/ui-tokens'
import { COMPONENT_CONTRACT, COMPONENT_NAMES, type ComponentSpec } from './contract.js'

export * from './contract.js'

/**
 * A kit, as this check sees it.
 *
 * Just its exports: the check runs on the module object, so it works without
 * a renderer, a DOM, or a device — which is what lets it run in CI on every
 * change rather than once a release.
 */
export type KitExports = Record<string, unknown>

/** Which props a component declares. Kits publish this beside the component. */
export type KitPropMap = Record<string, readonly string[]>

export interface ParityProblem {
  kind: 'missing' | 'extra' | 'not-a-component' | 'missing-prop' | 'contrast'
  detail: string
}

export interface ParityInput {
  desktop: KitExports
  mobile: KitExports
  /**
   * Props each kit accepts, by component.
   *
   * Declared rather than reflected: a React component's parameter names are
   * erased at runtime, and a build step that recovers them would be a bigger
   * thing to trust than the list itself.
   */
  desktopProps?: KitPropMap
  mobileProps?: KitPropMap
}

/**
 * Everything wrong with the pair, as a list.
 *
 * A list rather than a boolean so a CI failure names the component and the
 * prop. "Parity check failed" sends someone diffing two packages by hand.
 */
export function checkParity(input: ParityInput): ParityProblem[] {
  const problems: ParityProblem[] = []

  for (const [target, exports] of [
    ['desktop', input.desktop],
    ['mobile', input.mobile],
  ] as const) {
    for (const spec of COMPONENT_CONTRACT) {
      const value = exports[spec.name]
      if (value === undefined) {
        problems.push({
          kind: 'missing',
          detail: `${target} does not export ${spec.name} (${spec.purpose})`,
        })
        continue
      }
      // A component is callable. An object exported under a component's name
      // is the shape a barrel-file mistake takes.
      if (typeof value !== 'function' && typeof value !== 'object') {
        problems.push({
          kind: 'not-a-component',
          detail: `${target}.${spec.name} is a ${typeof value}, not a component`,
        })
      }
    }

    // A kit may export helpers; it may not export a *component* the other
    // does not have, because a plugin author will find it and use it.
    for (const name of Object.keys(exports)) {
      if (!/^[A-Z]/.test(name)) continue
      if (COMPONENT_NAMES.includes(name)) continue
      problems.push({
        kind: 'extra',
        detail:
          `${target} exports ${name}, which is not in the contract — ` +
          'add it to COMPONENT_CONTRACT and implement it in both kits, or unexport it',
      })
    }
  }

  problems.push(...propProblems('desktop', input.desktopProps))
  problems.push(...propProblems('mobile', input.mobileProps))

  for (const issue of paletteContrastIssues()) {
    problems.push({
      kind: 'contrast',
      detail: `${issue.scheme}: ${issue.pair} is ${issue.ratio}:1, needs ${issue.required}:1`,
    })
  }

  return problems
}

function propProblems(target: string, declared: KitPropMap | undefined): ParityProblem[] {
  if (!declared) return []
  const problems: ParityProblem[] = []
  for (const spec of COMPONENT_CONTRACT) {
    const accepted = declared[spec.name]
    if (!accepted) continue // the kit did not declare; `missing` already covers absence
    for (const prop of spec.props) {
      if (accepted.includes(prop.name)) continue
      problems.push({
        kind: 'missing-prop',
        detail:
          `${target}.${spec.name} does not accept "${prop.name}"` +
          (prop.note ? ` — ${prop.note}` : ''),
      })
    }
  }
  return problems
}

/** A message a CI log can be read from. */
export function formatProblems(problems: readonly ParityProblem[]): string {
  if (problems.length === 0) return 'kits are in parity'
  return problems.map((p) => `  [${p.kind}] ${p.detail}`).join('\n')
}

/** The contract entry for one component, for a kit's own tests. */
export function specFor(name: string): ComponentSpec | undefined {
  return COMPONENT_CONTRACT.find((c) => c.name === name)
}

/** Props the contract requires of a component. */
export function requiredProps(name: string): string[] {
  return specFor(name)?.props.filter((p) => p.required).map((p) => p.name) ?? []
}
