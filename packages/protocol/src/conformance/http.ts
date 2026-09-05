/**
 * Conformance suite for `ctx.http` — the M1 slice.
 *
 * Per MD-1 (docs/11 §1.3) M1 ships GET and HEAD, arbitrary headers, `Range`,
 * `stream()`, `onProgress`, `timeoutMs`, `AbortSignal` and redirect handling.
 * `cookies` and `download()` are **absent from this suite, not asserted to
 * throw** — a member that throws is a lie about the contract, and M2 adds
 * cases here rather than rewriting the file.
 *
 * The checks run against a *real byte-serving fixture*, never a mock. The
 * behaviour that matters for streaming — a 206 that starts at the requested
 * offset, a body that arrives in pieces, a stall that ends as an error rather
 * than a hang — is behaviour of a transport talking to a socket, and a mock
 * proves nothing about it (docs/11 §4.5, §7).
 *
 * ## What a subject's `origin` must serve
 *
 * | Route | Behaviour |
 * |---|---|
 * | `GET /bytes` | `payload`, `Accept-Ranges: bytes`, honours `Range` with a 206 and `Content-Range` |
 * | `HEAD /bytes` | The same headers, no body |
 * | `GET /echo` | `application/json` — `{ method, headers }` as the server saw them |
 * | `GET /slow?ms=N` | Waits N ms, then 200 with a short body |
 * | `GET /stall` | Sends one chunk, then never another and never ends |
 * | `GET /redirect?to=<path>` | 302 to `<path>` on the same origin |
 * | `GET /status?code=N` | Responds N with a short body |
 */

import type { HttpService } from '../index.js'
import { assert, assertRejects, type ConformanceSuite } from './harness.js'

export interface HttpSubject {
  http: HttpService
  /** Base URL of a byte-serving fixture, no trailing slash. */
  origin: string
  /** The exact bytes `GET /bytes` serves. */
  payload: Uint8Array
}

/** Read a whole stream, so the chunking is exercised rather than bypassed. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}

export const httpConformance: ConformanceSuite<HttpSubject> = {
  service: 'http',
  checks: [
    {
      name: 'GET returns the bytes the server sent',
      because: 'everything else here is a variation on this one working',
      async run({ http, origin, payload }) {
        const response = await http({ url: `${origin}/bytes` })
        assert(response.status === 200, `expected 200, got ${response.status}`)
        const bytes = await response.bytes()
        assert(sameBytes(bytes, payload), `body differs: ${bytes.byteLength} of ${payload.byteLength}`)
      },
    },

    {
      name: 'HEAD returns headers and no body',
      because: 'the runtime derives seekability from a HEAD rather than by downloading a track',
      async run({ http, origin, payload }) {
        const response = await http({ url: `${origin}/bytes`, method: 'HEAD' })
        assert(response.status === 200, `expected 200, got ${response.status}`)
        assert(
          response.headers['accept-ranges'] === 'bytes',
          'Accept-Ranges is how capabilities.streaming.seekable is decided when the document is silent',
        )
        assert(
          response.headers['content-length'] === String(payload.byteLength),
          'a HEAD still reports the length it would have sent',
        )
      },
    },

    {
      name: 'headers a browser would refuse are sent verbatim',
      because:
        'the desktop transport exists precisely so Range, Cookie and User-Agent reach the server',
      async run({ http, origin }) {
        const response = await http({
          url: `${origin}/echo`,
          headers: { 'x-bbebee': 'probe', range: 'bytes=0-1' },
        })
        const seen = await response.json<{ headers: Record<string, string> }>()
        assert(seen.headers['x-bbebee'] === 'probe', 'a custom header survived the transport')
        assert(seen.headers['range'] === 'bytes=0-1', 'Range survived the transport')
      },
    },

    {
      name: 'a Range request answers 206 from the requested offset',
      because: 'seeking in a stream is a Range request; without this, seek re-downloads the track',
      async run({ http, origin, payload }) {
        const start = Math.floor(payload.byteLength / 2)
        const response = await http({
          url: `${origin}/bytes`,
          headers: { range: `bytes=${start}-` },
        })
        assert(response.status === 206, `expected 206, got ${response.status}`)
        const range = response.headers['content-range'] ?? ''
        assert(
          range.startsWith(`bytes ${start}-`),
          `Content-Range should start at ${start}, got "${range}"`,
        )
        const bytes = await response.bytes()
        assert(
          sameBytes(bytes, payload.slice(start)),
          'the tail returned is the tail that was asked for',
        )
      },
    },

    {
      name: 'stream() delivers the body in pieces',
      because:
        'a 60 MB track must start playing before it has finished arriving, which buffering forbids',
      async run({ http, origin, payload }) {
        const response = await http({ url: `${origin}/bytes` })
        const bytes = await drain(response.stream())
        assert(sameBytes(bytes, payload), 'a streamed body is the same body')
      },
    },

    {
      name: 'onProgress reports monotonically and ends at the total',
      because: 'a progress bar that goes backwards or stops short is worse than none',
      async run({ http, origin, payload }) {
        const seen: number[] = []
        const response = await http({
          url: `${origin}/bytes`,
          onProgress: (loaded) => void seen.push(loaded),
        })
        await drain(response.stream())
        assert(seen.length > 0, 'progress was reported at least once')
        for (let i = 1; i < seen.length; i++) {
          assert(seen[i]! >= seen[i - 1]!, `progress went backwards: ${seen.join(',')}`)
        }
        assert(
          seen[seen.length - 1] === payload.byteLength,
          `final progress ${seen[seen.length - 1]} should equal ${payload.byteLength}`,
        )
      },
    },

    {
      name: 'a redirect is followed and the final url is reported',
      because: 'relative links in a source document resolve against the url that answered',
      async run({ http, origin, payload }) {
        const response = await http({ url: `${origin}/redirect?to=/bytes` })
        assert(response.status === 200, `expected 200, got ${response.status}`)
        assert(
          response.url === `${origin}/bytes`,
          `expected the final url, got ${response.url}`,
        )
        assert(sameBytes(await response.bytes(), payload), 'the redirect target answered')
      },
    },

    {
      name: 'redirect: manual hands the 302 back',
      because: 'a login flow reads the Location itself rather than being taken there',
      async run({ http, origin }) {
        const response = await http({ url: `${origin}/redirect?to=/bytes`, redirect: 'manual' })
        assert(response.status === 302, `expected 302, got ${response.status}`)
        assert(
          (response.headers['location'] ?? '').includes('/bytes'),
          'the Location header is readable',
        )
      },
    },

    {
      name: 'redirect: error rejects rather than following',
      because: 'a caller who asked to be told is not served by a silent hop',
      async run({ http, origin }) {
        await assertRejects(
          () => http({ url: `${origin}/redirect?to=/bytes`, redirect: 'error' }),
          'a redirect under redirect:error rejects',
          /redirect/i,
        )
      },
    },

    {
      name: 'a 404 is returned, not thrown',
      because:
        'a source distinguishes "not found" from "the network failed", and the taxonomy needs the status',
      async run({ http, origin }) {
        const response = await http({ url: `${origin}/status?code=404` })
        assert(response.status === 404, `expected 404, got ${response.status}`)
      },
    },

    {
      name: 'timeoutMs ends a request that never answers',
      because: 'a hung request holds a wake lock on mobile for as long as it hangs',
      async run({ http, origin }) {
        await assertRejects(
          () => http({ url: `${origin}/slow?ms=5000`, timeoutMs: 150 }),
          'a slow response is abandoned',
          () => true,
        )
      },
    },

    {
      name: 'an AbortSignal ends a request in flight',
      because: 'the player cancels a prefetch when the queue changes, and it must actually stop',
      async run({ http, origin }) {
        const controller = new AbortController()
        const inFlight = http({ url: `${origin}/slow?ms=5000`, signal: controller.signal })
        // Late enough that the request is genuinely open, early enough that
        // the server has not answered.
        setTimeout(() => controller.abort(), 50)
        await assertRejects(() => inFlight, 'an aborted request rejects', () => true)
      },
    },

    {
      name: 'aborting mid-body ends the stream rather than hanging',
      because:
        'a stalled stream is the case where a socket is held open forever, on the platform least able to afford it',
      async run({ http, origin }) {
        const controller = new AbortController()
        const response = await http({ url: `${origin}/stall`, signal: controller.signal })
        const reader = response.stream().getReader()

        /*
         * The read loop is started *before* the abort is scheduled, and never
         * awaited on its own.
         *
         * Reading one chunk first and aborting afterwards would make the check
         * depend on when the server's first write reaches the socket — and on
         * a stalled connection that is exactly the thing that may never
         * happen, so the check would hang instead of failing.
         */
        const drained = (async () => {
          for (;;) {
            const { done } = await reader.read()
            if (done) return
          }
        })()
        const timer = setTimeout(() => controller.abort(), 100)

        try {
          await assertRejects(
            () => drained,
            'reading past an abort fails rather than blocking',
            () => true,
          )
        } finally {
          clearTimeout(timer)
        }
      },
    },
  ],
}
