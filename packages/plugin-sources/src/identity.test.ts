/**
 * Identity, validation, and the verbatim round-trip.
 *
 * These are the functions that decide whether a re-import updates a source or
 * silently skips it, and whether a shared document comes back the way it went
 * out. Both failures are quiet, which is why they are tested closely.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { SourceFormatError } from '@BBeBee/protocol'
import {
  allowedHostsFor,
  changedFields,
  docHashOf,
  exportableDocument,
  parseSourceInput,
  recordFor,
  sourceIdFor,
  validateDocument,
} from './identity.js'

const doc = (extra: Record<string, unknown> = {}) => ({
  sourceUrl: 'https://music.example.org',
  sourceName: 'Example',
  ruleStream: { url: '={{source.url}}' },
  ...extra,
})

describe('sourceIdFor', () => {
  it('is derived from sourceUrl with SHA-256, not a 32-bit hash', () => {
    // The suffix used to be 16 bits of FNV-1a, where a same-host collision
    // reaches ~7% at a hundred sources — and a collision makes ON CONFLICT(id)
    // overwrite an unrelated source's row wholesale.
    const url = 'https://music.example.org'
    const expected = createHash('sha256').update(url).digest('hex').slice(0, 8)
    expect(sourceIdFor(url)).toBe(`music-example-org-${expected}`)
  })

  it('is stable, which is what makes re-import an update', () => {
    expect(sourceIdFor('https://music.example.org')).toBe(sourceIdFor('https://music.example.org'))
  })

  it('separates two paths on one host', () => {
    expect(sourceIdFor('https://x.test/a')).not.toBe(sourceIdFor('https://x.test/b'))
  })

  it('never contains the URN separator', () => {
    // A ':' here would make every URN in the namespace unparseable.
    expect(sourceIdFor('https://x.test:8443/a')).not.toContain(':')
  })
})

describe('docHashOf', () => {
  it('is the full SHA-256 of the stored text', () => {
    expect(docHashOf('{"a":1}')).toBe(createHash('sha256').update('{"a":1}').digest('hex'))
  })

  it('changes when the document does', () => {
    expect(docHashOf('{"a":1}')).not.toBe(docHashOf('{"a":2}'))
  })
})

describe('validateDocument', () => {
  it('accepts the smallest legal document', () => {
    expect(validateDocument(doc())).toMatchObject({ sourceName: 'Example' })
  })

  it('requires ruleStream, the one block a source cannot do without', () => {
    const withoutStream = { ...doc() } as Record<string, unknown>
    delete withoutStream.ruleStream
    expect(() => validateDocument(withoutStream)).toThrow(SourceFormatError)
  })

  it('rejects an empty stream url', () => {
    expect(() => validateDocument(doc({ ruleStream: { url: '  ' } }))).toThrow(SourceFormatError)
  })

  it('collects every issue rather than the first', () => {
    // The import screen lists them; fixing one at a time is miserable.
    try {
      validateDocument({ sourceName: 42 })
      expect.unreachable('should have thrown')
    } catch (error) {
      const issues = (error as SourceFormatError).issues
      expect(issues.map((i) => i.path).sort()).toEqual(['ruleStream', 'sourceName', 'sourceUrl'])
    }
  })

  it('rejects a non-string where a value reaches SQLite', () => {
    // `sortOrder: {}` used to reach the driver and crash the whole import
    // rather than landing in `rejected` as one bad entry.
    expect(() => validateDocument(doc({ sortOrder: {} }))).toThrow(SourceFormatError)
    expect(() => validateDocument(doc({ sourceGroup: 7 }))).toThrow(SourceFormatError)
    expect(() => validateDocument(doc({ enabled: 'yes' }))).toThrow(SourceFormatError)
  })

  it('rejects a rule field that is not a string', () => {
    expect(() => validateDocument(doc({ ruleStream: { url: '=x', seekable: true } }))).toThrow(
      SourceFormatError,
    )
  })

  it('rejects a sourceUrl with surrounding whitespace', () => {
    // Otherwise ' https://x' and 'https://x' are two sources for one backend.
    expect(() => validateDocument(doc({ sourceUrl: ' https://x.test' }))).toThrow(
      SourceFormatError,
    )
  })

  it('rejects a non-http scheme', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
      expect(() => validateDocument(doc({ sourceUrl: url })), url).toThrow(SourceFormatError)
    }
  })

  it('rejects credentials embedded in the URL', () => {
    // The document is stored, exported and shared: a credential in the URL
    // would travel with it, which is the one thing export must never do.
    try {
      validateDocument(doc({ sourceUrl: 'https://u:p@x.test' }))
      expect.unreachable('should have thrown')
    } catch (error) {
      const issues = (error as SourceFormatError).issues
      expect(issues.map((i) => i.message).join(' ')).toMatch(/must not embed credentials/)
    }
  })
})

describe('parseSourceInput', () => {
  it('keeps each entry’s verbatim text, not a re-serialisation', () => {
    // Export must emit what was imported — key order and spacing included —
    // or a user's document comes back subtly different and they stop trusting
    // export (docs/07 §4.1).
    const input = '[{"b":  2, "a": 1},\n {"z": [1,2]}]'
    const entries = parseSourceInput(input)
    expect(entries.map((e) => e.text)).toEqual(['{"b":  2, "a": 1}', '{"z": [1,2]}'])
  })

  it('handles a single object', () => {
    expect(parseSourceInput('{"a": 1}')[0]!.text).toBe('{"a": 1}')
  })

  it('is not confused by braces and brackets inside strings', () => {
    const input = '[{"n": "a}]{[ b"}, {"n": "x"}]'
    const entries = parseSourceInput(input)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.text).toBe('{"n": "a}]{[ b"}')
  })

  it('is not confused by an escaped quote', () => {
    const input = '[{"n": "say \\"hi\\""}, {"n": "x"}]'
    const entries = parseSourceInput(input)
    expect(entries).toHaveLength(2)
    expect(JSON.parse(entries[0]!.text)).toEqual({ n: 'say "hi"' })
  })

  it('unwraps a markdown code fence, which is how people paste', () => {
    const entries = parseSourceInput('```json\n{"a": 1}\n```')
    expect(JSON.parse(entries[0]!.text)).toEqual({ a: 1 })
  })

  it('rejects invalid JSON with a usable message', () => {
    expect(() => parseSourceInput('{nope')).toThrow(SourceFormatError)
    expect(() => parseSourceInput('   ')).toThrow(/nothing to import/)
  })

  it('agrees with JSON.parse on element count for every span it recovers', () => {
    const input = '[1, "two", {"a": [3]}, [4, 5], null, true]'
    const entries = parseSourceInput(input)
    expect(entries).toHaveLength(6)
    for (const entry of entries) {
      expect(JSON.parse(entry.text)).toEqual(entry.value)
    }
  })
})

describe('changedFields', () => {
  it('reports a real change', () => {
    expect(changedFields(doc() as never, doc({ sourceName: 'Other' }) as never)).toEqual([
      'sourceName',
    ])
  })

  it('ignores key order inside a rule block', () => {
    // A document round-tripped through an editor that sorts keys would
    // otherwise report every block as modified and ask the user to confirm an
    // update that changes nothing.
    const a = doc({ ruleStream: { url: '=x', mimeType: '=audio/mpeg' } }) as never
    const b = doc({ ruleStream: { mimeType: '=audio/mpeg', url: '=x' } }) as never
    expect(changedFields(a, b)).toEqual([])
  })

  it('ignores fields the app maintains', () => {
    expect(changedFields(doc() as never, doc({ respondTime: 42 }) as never)).toEqual([])
  })
})

describe('allowedHostsFor', () => {
  it('always includes the source’s own host', () => {
    expect(allowedHostsFor(doc() as never)).toEqual(['music.example.org'])
  })

  it('adds declared hosts, deduplicated and sorted', () => {
    const hosts = allowedHostsFor(
      doc({ allowedHosts: ['https://cdn.example.org', 'cdn.example.org', 'a.test'] }) as never,
    )
    expect(hosts).toEqual(['a.test', 'cdn.example.org', 'music.example.org'])
  })
})

describe('exportableDocument', () => {
  it('strips what the app maintains, so sharing leaks nothing about you', () => {
    const out = exportableDocument(
      doc({ respondTime: 180, lastUpdated: 1, weight: 3 }) as never,
    ) as unknown as Record<string, unknown>
    expect(out.respondTime).toBeUndefined()
    expect(out.lastUpdated).toBeUndefined()
    expect(out.weight).toBeUndefined()
    expect(out.sourceName).toBe('Example')
  })
})

describe('recordFor', () => {
  it('takes the caller’s enabled flag over the document’s', () => {
    // The user's switch wins: an author publishing an update must not turn a
    // source back on that the user switched off.
    const record = recordFor(doc({ enabled: true }) as never, {
      docJson: '{}',
      now: 1,
      enabled: false,
    })
    expect(record.enabled).toBe(false)
  })

  it('hashes the exact text it was given', () => {
    const record = recordFor(doc() as never, { docJson: '{"verbatim": true}', now: 1 })
    expect(record.docHash).toBe(docHashOf('{"verbatim": true}'))
  })
})
