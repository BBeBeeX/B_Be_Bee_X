/**
 * A document nobody compiled, searching.
 *
 * This is the claim the whole string model rests on (docs/10 §M2): a
 * Subsonic-shaped source imported as *text* renders its search URL, fetches,
 * runs its rules, and returns tracks. The document under test is the one
 * shipped in `fixtures/sources/`, so a change to the rule engine that breaks
 * a real document fails here.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { RuleError } from '@BBeBee/protocol'
import type { HttpRequest, HttpService, SourceRecord } from '@BBeBee/protocol'
import { DocumentSource } from './source.js'

const SUBSONIC_RESPONSE = {
  'subsonic-response': {
    status: 'ok',
    searchResult3: {
      song: [
        { id: '1', title: 'Jóga', artist: 'Björk', album: 'Homogenic', albumId: 'a1', duration: 303, suffix: 'flac' },
        { id: '2', title: 'Bachelorette', artist: 'Björk', album: 'Homogenic', albumId: 'a1', duration: 315, suffix: 'flac' },
      ],
    },
  },
}

/** An `http` that records requests and replays a canned body. */
function fakeHttp(body: unknown, status = 200) {
  const requests: HttpRequest[] = []
  const http = (async (req: HttpRequest) => {
    requests.push(req)
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return {
      status,
      headers: { 'content-type': 'application/json' },
      url: req.url,
      text: async () => text,
      json: async () => JSON.parse(text) as unknown,
      bytes: async () => new Uint8Array(),
      stream: () => new ReadableStream(),
    }
  }) as unknown as HttpService
  return { http, requests }
}

async function shippedDocument(): Promise<Record<string, unknown>> {
  const raw = await readFile(new URL('../../../../fixtures/sources/subsonic.json', import.meta.url), 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

function recordFor(doc: Record<string, unknown>): SourceRecord {
  return {
    id: 'music-example-org-35be9fe2',
    sourceUrl: String(doc.sourceUrl),
    name: String(doc.sourceName),
    type: 'music',
    doc: doc as never,
    docJson: JSON.stringify(doc),
    docHash: 'h',
    enabled: true,
    sortOrder: 0,
    allowedHosts: ['music.example.org'],
    locallyModified: false,
    importedAt: 0,
    updatedAt: 0,
    failCount: 0,
  }
}

describe('the shipped Subsonic document', () => {
  it('declares itself searchable', async () => {
    // Derived, not asserted by the document: the rules it uses are all in
    // engines this build can run.
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    expect(source.capabilities.search.tracks).toBe(true)
    expect(source.provider().search, 'present, not stubbed').toBeTypeOf('function')
  })

  it('renders the search URL from the template', async () => {
    const { http, requests } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    await source.search({ text: 'björk' })

    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toContain('https://music.example.org/rest/search3')
    expect(requests[0]!.url, 'the search text reaches {{key}}').toContain('query=björk')
  })

  it('turns the response into tracks', async () => {
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    const result = await source.search({ text: 'björk' })

    const tracks = result.tracks!.items
    expect(tracks).toHaveLength(2)
    expect(tracks[0]).toMatchObject({
      urn: 'BBeBee:music-example-org-35be9fe2:track:1',
      title: 'Jóga',
      albumTitle: 'Homogenic',
    })
    expect(tracks[0]!.artists[0]!.name).toBe('Björk')
  })

  it('converts the seconds-based duration with the ## replacement', async () => {
    // `$.duration##$##000` is how every seconds-based API becomes durationMs,
    // and getting it wrong shows up as a scrubber that never moves.
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    const result = await source.search({ text: 'x' })
    expect(result.tracks!.items[0]!.durationMs).toBe(303_000)
  })

  it('pages by incrementing the cursor', async () => {
    const { http, requests } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    const first = await source.search({ text: 'x' })
    expect(first.tracks!.cursor).toBe('2')

    await source.search({ text: 'x' }, { cursor: '2' })
    // This document does not use {{page}}, so the URL is the same — which is
    // exactly why paging cannot be trusted to `hasMore` alone.
    expect(requests).toHaveLength(2)
  })

  it('refuses a host the document did not declare', async () => {
    const doc = await shippedDocument()
    doc.searchUrl = '=http://169.254.169.254/latest/meta-data/'
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(doc), { http })
    await expect(source.search({ text: 'x' })).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('rules that do not hold up', () => {
  const withRules = async (over: Record<string, unknown>) => {
    const doc = await shippedDocument()
    return { ...doc, ruleSearch: { ...(doc.ruleSearch as object), ...over } }
  }

  it('drops a row missing a required field rather than importing it half-built', async () => {
    const { http } = fakeHttp({
      'subsonic-response': {
        searchResult3: { song: [{ id: '1' }, { id: '2', title: 'Real' }] },
      },
    })
    const notes: string[] = []
    const source = new DocumentSource(recordFor(await shippedDocument()), {
      http,
      log: (m) => void notes.push(m),
    })
    const result = await source.search({ text: 'x' })

    expect(result.tracks!.items).toHaveLength(1)
    // Counted, not hidden: three of twenty results reads as a thin backend
    // rather than as a broken rule.
    expect(notes.join(' ')).toContain('dropped 1')
  })

  it('raises a RuleError for a duration it cannot coerce', async () => {
    const { http } = fakeHttp({
      'subsonic-response': {
        searchResult3: { song: [{ id: '1', title: 'x', duration: 'ages' }] },
      },
    })
    const doc = await withRules({ durationMs: '$.duration' })
    const source = new DocumentSource(recordFor(doc), { http })
    // Not NaN in the catalogue: that surfaces much later as a scrubber that
    // does not move, with nothing to connect it to.
    await expect(source.search({ text: 'x' })).rejects.toThrow(RuleError)
  })

  it('accepts the duration spellings documents actually use', async () => {
    for (const [written, expected] of [
      ['213', 213],
      ['3:33', 213_000],
      ['1:02:03', 3_723_000],
      ['213.5s', 213_500],
    ] as const) {
      const { http } = fakeHttp({
        'subsonic-response': {
          searchResult3: { song: [{ id: '1', title: 'x', duration: written }] },
        },
      })
      const doc = await withRules({ durationMs: '$.duration' })
      const source = new DocumentSource(recordFor(doc), { http })
      const result = await source.search({ text: 'x' })
      expect(result.tracks!.items[0]!.durationMs, written).toBe(expected)
    }
  })

  it('is not searchable when its rules need an engine this build lacks', async () => {
    // A perfectly good document that this build cannot serve. Declaring the
    // capability anyway offers a button the runtime would fail.
    const doc = await withRules({ trackList: '@css:li.song' })
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(doc), { http })
    expect(source.capabilities.search.tracks).toBe(false)
    expect(source.provider().search).toBeUndefined()
  })

  it('maps a backend error onto the taxonomy', async () => {
    const { http } = fakeHttp({}, 503)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    await expect(source.search({ text: 'x' })).rejects.toMatchObject({
      code: 'network',
      retryable: true,
    })
  })

  it('derives streaming qualities from ruleStream.qualities, doc.qualities, or fallback', async () => {
    const docBase = await shippedDocument()
    const { http } = fakeHttp({})

    // 1. ruleStream.qualities
    const docWithRuleStreamQualities = {
      ...docBase,
      ruleStream: { ...((docBase.ruleStream as any) || {}), qualities: ['low', 'normal', 'high'] },
    }
    const s1 = new DocumentSource(recordFor(docWithRuleStreamQualities), { http })
    expect(s1.capabilities.streaming.qualities).toEqual(['low', 'normal', 'high'])

    // 2. doc.qualities
    const docWithDocQualities = {
      ...docBase,
      qualities: ['normal', 'hi-res'],
    }
    const s2 = new DocumentSource(recordFor(docWithDocQualities), { http })
    expect(s2.capabilities.streaming.qualities).toEqual(['normal', 'hi-res'])

    // 3. ruleStream.qualities takes precedence over doc.qualities
    const docWithBoth = {
      ...docBase,
      qualities: ['normal'],
      ruleStream: { ...((docBase.ruleStream as any) || {}), qualities: ['lossless', 'hi-res'] },
    }
    const s3 = new DocumentSource(recordFor(docWithBoth), { http })
    expect(s3.capabilities.streaming.qualities).toEqual(['lossless', 'hi-res'])

    // 4. Default fallback when url has no prefs.quality
    const s4 = new DocumentSource(recordFor(docBase), { http })
    expect(s4.capabilities.streaming.qualities).toEqual(['normal'])
  })
})
