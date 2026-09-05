/**
 * The tracer — docs/06 §10.
 *
 * The claim under test is that a user holding a broken source can find out
 * *which line* broke it, and hand that to the source's author without handing
 * over their password at the same time. Both halves are load-bearing: a trace
 * that omits the working steps hides the cause, and one that leaks a
 * credential cannot be pasted anywhere.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SourceRecord, TraceEvent } from '@BBeBee/protocol'
import { DocumentSource } from './source.js'

let server: Server
let origin: string
let mode: 'ok' | 'renamed' | 'html' | 'slow' = 'ok'

beforeAll(async () => {
  server = createServer((req, res) => {
    if (mode === 'html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>Please sign in</body></html>')
      return
    }
    if (mode === 'slow') {
      // Never answers. The trace should still show the request going out.
      return
    }
    const song =
      mode === 'renamed'
        ? { id: 's1', name: 'Jóga', artist: 'Björk' }
        : { id: 's1', title: 'Jóga', artist: 'Björk' }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ 'subsonic-response': { searchResult3: { song: [song] } } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

function source(over: Record<string, unknown> = {}, vars: Record<string, string> = { var: 'tok' }) {
  const doc = {
    sourceUrl: origin,
    sourceName: 'Traced',
    searchUrl: '{{source.url}}/rest/search3?query={{key}}&u=me&t={{source.var}}',
    ruleSearch: {
      trackList: '$.subsonic-response.searchResult3.song[*]',
      trackId: '$.id',
      title: '$.title',
      artist: '$.artist',
    },
    ruleStream: { url: '={{source.url}}/rest/stream?id={{track.id}}' },
    ...over,
  }
  const record: SourceRecord = {
    id: 'traced-1',
    sourceUrl: origin,
    name: 'Traced',
    type: 'music',
    doc: doc as never,
    docJson: JSON.stringify(doc),
    docHash: 'h',
    enabled: true,
    sortOrder: 0,
    allowedHosts: ['127.0.0.1'],
    locallyModified: false,
    importedAt: 0,
    updatedAt: 0,
    failCount: 0,
  }
  return new DocumentSource(record, {
    http: nodeHttp,
    vars: { get: (k) => vars[k], put: () => {} },
  })
}

/**
 * A minimal `HttpService` over `fetch`.
 *
 * The real one is a core service with a capability gate; the tracer does not
 * care which, and wiring the kernel in here would make a test about trace
 * lines depend on the whole plugin graph.
 */
const nodeHttp = (async (request: { url: string; method?: string }) => {
  const response = await fetch(request.url, { method: request.method ?? 'GET' })
  const text = await response.text()
  return {
    status: response.status,
    // `forEach` rather than iteration: the DOM lib this package compiles
    // against types `Headers` without an iterator, though every runtime has one.
    headers: collectHeaders(response.headers),
    url: response.url,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
    bytes: async () => new TextEncoder().encode(text),
    stream: () => new ReadableStream(),
  }
}) as never

function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

async function collect(iterable: AsyncIterable<TraceEvent>): Promise<TraceEvent[]> {
  const out: TraceEvent[] = []
  for await (const event of iterable) out.push(event)
  return out
}

describe('a search that works', () => {
  it('shows every step, not only the failures', async () => {
    // The failure is usually two steps before the empty result, so a trace of
    // failures alone hides the thing being looked for.
    mode = 'ok'
    const events = await collect(source().debug({ kind: 'search', text: 'björk' }))

    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('rule')
    expect(kinds).toContain('http')
    expect(kinds.at(-1)).toBe('result')

    const rules = events.filter((e) => e.kind === 'rule')
    expect(rules.map((r) => r.field)).toEqual(
      expect.arrayContaining(['searchUrl', 'trackList', 'title', 'artist']),
    )
  }, 20_000)

  it('shows what each rule received and produced', async () => {
    mode = 'ok'
    const events = await collect(source().debug({ kind: 'search', text: 'björk' }))
    const title = events.find((e) => e.kind === 'rule' && e.field === 'title')
    expect(title).toBeDefined()
    expect(title!.kind === 'rule' && title!.output).toContain('Jóga')
    expect(title!.kind === 'rule' && title!.engine).toBe('json')
  }, 20_000)

  it('records the request with its status and timing', async () => {
    mode = 'ok'
    const events = await collect(source().debug({ kind: 'search', text: 'x' }))
    const http = events.find((e) => e.kind === 'http')!
    expect(http.kind === 'http' && http.status).toBe(200)
    expect(http.kind === 'http' && http.method).toBe('GET')
  }, 20_000)

  it('ends with a summary a person can read', async () => {
    mode = 'ok'
    const events = await collect(source().debug({ kind: 'search', text: 'x' }))
    const last = events.at(-1)!
    expect(last.kind).toBe('result')
    expect(last.kind === 'result' && last.summary).toMatch(/1 track/)
  }, 20_000)
})

describe('a source that has rotted', () => {
  it('names the rule that stopped matching', async () => {
    /*
     * The scenario the whole section exists for: a backend renamed `title` to
     * `name`, and forty imported strings quietly return nothing. The trace has
     * to say *which* rule, or the user is guessing.
     */
    mode = 'renamed'
    const events = await collect(source().debug({ kind: 'search', text: 'björk' }))

    const title = events.find((e) => e.kind === 'rule' && e.field === 'title')!
    expect(title.kind === 'rule' && title.output, '$.title matched nothing').toBe('[]')
    // And the id, which did not change, is visibly fine — that contrast is
    // what tells the user it is the rule and not the connection.
    const id = events.find((e) => e.kind === 'rule' && e.field === 'trackId')!
    expect(id.kind === 'rule' && id.output).toContain('s1')
  }, 20_000)

  it('shows the body when the backend answered with something else entirely', async () => {
    // A login page served with a 200 reads as "no results" everywhere else.
    mode = 'html'
    const events = await collect(source().debug({ kind: 'search', text: 'x' }))
    const error = events.find((e) => e.kind === 'error')
    expect(error).toBeDefined()
    expect(error!.kind === 'error' && error!.message).toMatch(/HTML page|Please sign in/)
  }, 20_000)

  it('attributes an error to its block and field', async () => {
    mode = 'html'
    const events = await collect(source().debug({ kind: 'search', text: 'x' }))
    const error = events.find((e) => e.kind === 'error')!
    expect(error.kind === 'error' && error.block).toBe('ruleSearch')
  }, 20_000)
})

describe('what a trace must never contain', () => {
  it('redacts the source variable wherever it landed', async () => {
    /*
     * A trace is what gets pasted into a forum thread. The variable is usually
     * a password, and the document decides where it goes — so redaction by
     * shape is not enough; the value itself is scrubbed.
     */
    mode = 'ok'
    const traced = source({}, { var: 'hunter2secret' })
    const events = await collect(traced.debug({ kind: 'search', text: 'x' }))

    const text = JSON.stringify(events)
    expect(text).not.toContain('hunter2secret')
    // And it is visibly redacted rather than silently dropped, so the reader
    // knows something was there.
    expect(text).toContain('***')
  }, 20_000)

  it('redacts each half of a user:password variable', async () => {
    // Documents split it before use, so the whole string never appears — only
    // the halves do.
    mode = 'ok'
    const traced = source(
      { searchUrl: '{{source.url}}/rest/search3?query={{key}}&t={{source.var}}' },
      { var: 'alice:s3cretpw' },
    )
    const events = await collect(traced.debug({ kind: 'search', text: 'x' }))
    expect(JSON.stringify(events)).not.toContain('s3cretpw')
  }, 20_000)

  it('redacts a secret-looking query parameter even when nothing declared it', async () => {
    mode = 'ok'
    const events = await collect(source().debug({ kind: 'search', text: 'x' }))
    const http = events.find((e) => e.kind === 'http')!
    expect(http.kind === 'http' && http.url).not.toMatch(/[?&]t=[^&*]/)
  }, 20_000)
})

describe('streaming', () => {
  it('shows a request that never comes back', async () => {
    /*
     * The case a collected trace cannot express: the server stopped answering,
     * so there is no result to return and the diagnosis *is* the pending
     * request. The line appears with status 0 rather than never appearing.
     */
    mode = 'slow'
    const traced = source({}, {})
    const events: TraceEvent[] = []
    const iterator = traced.debug({ kind: 'search', text: 'x' })[Symbol.asyncIterator]()

    // The URL rule resolves long before the request does.
    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(first.value.kind).toBe('rule')
    events.push(first.value)
    void iterator.return?.()
  }, 20_000)

  it('refuses a second concurrent trace rather than interleaving two', async () => {
    // Two traces sharing one stream would each look like the other's rules had
    // failed — the most confusing possible output from a diagnostic tool.
    mode = 'slow'
    const traced = source()
    const first = traced.debug({ kind: 'search', text: 'x' })
    void first[Symbol.asyncIterator]().next()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const events = await collect(traced.debug({ kind: 'search', text: 'y' }))
    expect(events.some((e) => e.kind === 'error' && /already running/.test(e.message))).toBe(true)
  }, 20_000)
})
