/**
 * The shared half of the scan-roots screen.
 *
 * `summarise` is the sentence both shells show after a scan, so getting it
 * wrong is getting it wrong twice — and the case that matters is the one that
 * is easiest to drop.
 */

import { describe, expect, it } from 'vitest'
import { summarise } from './hooks.js'

const summary = (over: Partial<Record<string, number>> = {}) => ({
  added: 0,
  updated: 0,
  removed: 0,
  errors: 0,
  ...over,
}) as never

describe('summarise', () => {
  it('reports what changed', () => {
    expect(summarise(summary({ added: 12 }))).toBe('12 added')
    expect(summarise(summary({ added: 12, updated: 3, removed: 1 }))).toBe(
      '12 added, 3 updated, 1 removed',
    )
  })

  it('never hides files it could not read', () => {
    // docs/06 §12: a file that fails to decode is surfaced as a count the
    // user can act on, never silently absent from the library.
    expect(summarise(summary({ added: 5, errors: 2 }))).toContain('2 could not be read')
  })

  it('says something rather than nothing when a scan changed nothing', () => {
    // An empty string here reads as "the scan did not run".
    expect(summarise(summary())).toBe('nothing changed')
  })

  it('omits the counts that are zero', () => {
    expect(summarise(summary({ added: 1 }))).not.toContain('0')
  })

  it('is empty before any scan has finished', () => {
    expect(summarise(undefined)).toBe('')
  })
})
