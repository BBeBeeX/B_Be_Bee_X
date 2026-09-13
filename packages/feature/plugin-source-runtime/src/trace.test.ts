/**
 * The tracer behind the test screen — docs/06 §10.
 *
 * The claim under test is that a user holding a broken source can see what
 * the feature actually did — every request, the whole output — and hand that
 * to the source's author without handing over their password at the same
 * time. Both halves are load-bearing: a trace that omits the working requests
 * hides the cause, and one that leaks a credential cannot be pasted anywhere.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SourceRecord, TraceEvent } from '@BBeBee/protocol'
import { DocumentSource } from './source.js'

let server: Server
let origin: string
let mode: 'ok' | 'renamed' | 'html' | 'slow' | 'reset' = 'ok'

beforeAll(async () => {
  server = createServer((req, res) => {
    if (mode === 'html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>Please sign in</body></html>')
      return
    }
    if (mode === 'slow') {
      // Never answers. The trace has nothing to show until it does.
      return
    }
    if (mode === 'reset') {
      // Kills the connection: the request went out and nothing came back,
      // which tracedHttp reports as a status-0 line rather than silence.
      res.socket?.destroy()
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
    vars: { get: (k) => vars[k], put: async () => {} },
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
  it('shows the request, the outcome, and the output whole', async () => {
    mode = 'ok'
    const events = await collect(source().debug({ kind: 'search', text: 'björk' }))

    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('http')
    expect(kinds).toContain('value')
    expect(kinds.at(-1)).toBe('result')

    const value = events.find((e) => e.kind === 'value' && e.label.includes('search result'))
    expect(value!.kind === 'value' && value!.value).toContain('Jóga')
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
  it('reports an empty match as an outcome, not an error', async () => {
    /*
     * A backend renamed `title` to `name`: the request still succeeds and the
     * rules still run, so the honest trace is a zero-track outcome with the
     * full response attached — the reader sees the backend answered and the
     * rules matched nothing.
     */
    mode = 'renamed'
    const events = await collect(source().debug({ kind: 'search', text: 'björk' }))
    const last = events.at(-1)!
    expect(last.kind).toBe('result')
    expect(last.kind === 'result' && last.summary).toContain('matched nothing')
    // And the backend's actual answer is right there in the trace — the body
    // is what tells the reader the field is now `name`.
    const body = events.find((e) => e.kind === 'value' && e.label.includes('body'))
    expect(body!.kind === 'value' && body!.value).toContain('"name"')
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
  it('shows a request that never came back as a status-0 line', async () => {
    /*
     * The case a collected trace cannot express: the request went out and
     * nothing came back. The line appears with status 0 — the conventional
     * "no response" — and the error follows it, rather than the run failing
     * with nothing on screen at all.
     */
    mode = 'reset'
    const events = await collect(source().debug({ kind: 'search', text: 'x' }))
    const http = events.find((e) => e.kind === 'http')!
    expect(http.kind === 'http' && http.status).toBe(0)
    expect(events.some((e) => e.kind === 'error')).toBe(true)
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

describe('redaction reaches the request lines too', () => {
  it('scrubs a credential that landed somewhere unremarkable in a URL', async () => {
    /*
     * ⚠️ Redaction by *shape* catches `t=` and `password=`. It does not catch
     * a password the document put in a path segment or under a name nobody
     * recognises — and the `http` lines were being redacted structurally and
     * not by value, so exactly that went into a trace meant to be pasted into
     * a forum thread.
     */
    mode = 'ok'
    const traced = source(
      { searchUrl: '{{source.url}}/x/{{source.var}}/search?q={{key}}&sess={{source.var}}' },
      { var: 'hunter2secret' },
    )
    const events = await collect(traced.debug({ kind: 'search', text: 'x' }))
    const http = events.find((e) => e.kind === 'http')!

    expect(http.kind === 'http' && http.url).not.toContain('hunter2secret')
    expect(JSON.stringify(events)).not.toContain('hunter2secret')
  }, 20_000)

  it('scrubs a form field’s value, not only the source variable', async () => {
    // A `form` source keeps its password under whatever id the document chose,
    // so a secret list that knew only about `var` redacted nothing for the
    // flow where the credential is most obviously one.
    mode = 'ok'
    const traced = source(
      {
        loginUi: [{ id: 'pw', label: 'Password', type: 'password' }],
        loginUrl: '{{source.url}}/login',
        searchUrl: '{{source.url}}/search?q={{key}}&p={{source.var}}',
      },
      { var: 'tok', pw: 'formpassword' },
    )
    const events = await collect(traced.debug({ kind: 'search', text: 'formpassword' }))
    expect(JSON.stringify(events)).not.toContain('formpassword')
  }, 20_000)
})
