/**
 * The gate, against the real kits.
 *
 * This is the check docs/08 §6 and docs/11 §4.11 ask for, and the reason it
 * reads manifests rather than modules: `ui-kit-mobile` cannot be imported off
 * a device, so a gate that needed the real module would only ever run for one
 * of the two kits — which is most of the way to no gate at all.
 */

import { describe, expect, it } from 'vitest'
import {
  COMPONENT_PROPS as DESKTOP_PROPS,
  COMPONENT_EXPORTS as DESKTOP_EXPORTS,
  KIT_TARGET as DESKTOP_TARGET,
} from '@BBeBee/ui-kit-desktop/manifest'
import {
  COMPONENT_PROPS as MOBILE_PROPS,
  COMPONENT_EXPORTS as MOBILE_EXPORTS,
  KIT_TARGET as MOBILE_TARGET,
} from '@BBeBee/ui-kit-mobile/manifest'
import { COMPONENT_NAMES, checkParity, formatProblems } from './index.js'

/** A manifest, as a module object the checker can read. */
const asExports = (names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, () => null]))

describe('the shipped kits', () => {
  it('are the two kits they say they are', () => {
    expect(DESKTOP_TARGET).toBe('desktop')
    expect(MOBILE_TARGET).toBe('mobile')
  })

  it('are in parity', () => {
    const problems = checkParity({
      desktop: asExports(DESKTOP_EXPORTS),
      mobile: asExports(MOBILE_EXPORTS),
      desktopProps: DESKTOP_PROPS,
      mobileProps: MOBILE_PROPS,
    })
    expect(problems, formatProblems(problems)).toEqual([])
  })

  it('export exactly the contract, in both kits', () => {
    expect([...DESKTOP_EXPORTS].sort()).toEqual([...COMPONENT_NAMES].sort())
    expect([...MOBILE_EXPORTS].sort()).toEqual([...COMPONENT_NAMES].sort())
  })

  it('accept identical props for every component', () => {
    // The drift that costs the most and shows the least: one kit quietly
    // growing a prop the other does not have.
    for (const name of COMPONENT_NAMES) {
      expect([...(DESKTOP_PROPS[name] ?? [])].sort(), name).toEqual(
        [...(MOBILE_PROPS[name] ?? [])].sort(),
      )
    }
  })
})
