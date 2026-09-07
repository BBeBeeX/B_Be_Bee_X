/**
 * A byte-serving HTTP fixture.
 *
 * `httpConformance` is written against a real socket rather than a mock,
 * because everything M1 needs from `ctx.http` is behaviour a mock cannot have:
 * a 206 that starts where it was asked to, a body that arrives in pieces, a
 * stall that has to end as an error rather than a hang (docs/11 §4.5, §7).
 *
 * Dev-only. Nothing here is bundled into either shell.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface ByteServer {
  /** Base URL, no trailing slash. */
  origin: string
  /** Exactly what `GET /bytes` serves. */
  payload: Uint8Array
  /** Requests seen, in order. Cleared by `reset()`. */
  readonly requests: { method: string; url: string; headers: Record<string, string> }[]
  reset(): void
  close(): Promise<void>
}

export interface ByteServerOptions {
  /** Body size for `/bytes`. Big enough to arrive in more than one chunk. */
  payloadBytes?: number
  /** Chunk size `/bytes` writes at a time. */
  chunkBytes?: number
}

/**
 * Deterministic filler.
 *
 * A repeating counter rather than random bytes, so a failure that shows a byte
 * offset is reproducible and a diff is readable.
 */
function makePayload(size: number): Uint8Array {
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = i % 251
  return out
}

/** `bytes=<start>-<end>` against a known length. Only the single-range form. */
function parseRange(header: string | undefined, total: number): { start: number; end: number } | undefined {
  if (!header) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  if (rawStart === '') {
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return undefined
    return { start: Math.max(0, total - length), end: total - 1 }
  }
  const start = Number(rawStart)
  const end = rawEnd === '' ? total - 1 : Number(rawEnd)
  if (!Number.isFinite(start) || start >= total) return undefined
  return { start, end: Math.min(end, total - 1) }
}

export async function startByteServer(options: ByteServerOptions = {}): Promise<ByteServer> {
  const payload = makePayload(options.payloadBytes ?? 64 * 1024)
  const chunkBytes = options.chunkBytes ?? 8 * 1024
  const requests: ByteServer['requests'] = []

  /** Sockets held open by `/stall`, so `close()` is not a hang of its own. */
  const stalled = new Set<ServerResponse>()

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    requests.push({
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]),
      ),
    })

    switch (url.pathname) {
      case '/bytes': {
        const range = parseRange(req.headers.range, payload.byteLength)
        const start = range?.start ?? 0
        const end = range?.end ?? payload.byteLength - 1
        const slice = payload.subarray(start, end + 1)

        res.setHeader('accept-ranges', 'bytes')
        res.setHeader('content-type', 'application/octet-stream')
        res.setHeader('content-length', String(slice.byteLength))
        res.setHeader('etag', `"${payload.byteLength}"`)
        if (range) {
          res.setHeader('content-range', `bytes ${start}-${end}/${payload.byteLength}`)
          res.statusCode = 206
        } else {
          res.statusCode = 200
        }
        if (req.method === 'HEAD') {
          // The length reported is the length that *would* have been sent.
          res.setHeader('content-length', String(payload.byteLength))
          res.end()
          return
        }
        // Written in pieces so `stream()` and `onProgress` see more than one.
        void (async () => {
          try {
            for (let at = 0; at < slice.byteLength; at += chunkBytes) {
              // A client that aborted mid-body leaves a destroyed socket. Both
              // the write and the `drain` that never comes would then be an
              // unhandled rejection — from a *fixture*, failing a run for a
              // reason that has nothing to do with the code under test.
              if (res.writableEnded || res.destroyed) return
              if (!res.write(slice.subarray(at, Math.min(at + chunkBytes, slice.byteLength)))) {
                await new Promise<void>((resolve) => {
                  res.once('drain', resolve)
                  res.once('close', resolve)
                })
              }
            }
            if (!res.destroyed) res.end()
          } catch {
            /* the client went away mid-write */
          }
        })()
        return
      }

      case '/echo': {
        const body = JSON.stringify({
          method: req.method,
          headers: requests[requests.length - 1]!.headers,
        })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(body)
        return
      }

      case '/slow': {
        const ms = Number(url.searchParams.get('ms') ?? '100')
        const timer = setTimeout(() => {
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end('late')
        }, ms)
        // A client that gives up must not keep the process alive waiting to
        // answer it.
        res.on('close', () => clearTimeout(timer))
        return
      }

      case '/stall': {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.write(new Uint8Array([1, 2, 3, 4]))
        stalled.add(res)
        res.on('close', () => stalled.delete(res))
        return
      }

      case '/redirect': {
        res.writeHead(302, { location: url.searchParams.get('to') ?? '/bytes' })
        res.end()
        return
      }

      case '/status': {
        const code = Number(url.searchParams.get('code') ?? '200')
        res.writeHead(code, { 'content-type': 'text/plain' })
        res.end(code === 204 || code === 304 ? undefined : String(code))
        return
      }

      default:
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${address.port}`,
    payload,
    requests,
    reset() {
      requests.length = 0
    },
    async close() {
      for (const res of stalled) res.destroy()
      stalled.clear()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
