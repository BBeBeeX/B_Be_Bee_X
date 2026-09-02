/**
 * `ctx.http` for desktop — the M1 slice.
 *
 * A `fetch`-shaped client that is *not* subject to browser rules. In the
 * shipped desktop app the transport is Electron's `net` module in `main`, for
 * the CORS and header reasons in docs/02 §2; here it is a seam
 * (`config.fetch`) so the same service runs under test and in `main` itself.
 *
 * Every request goes through the `http/request` waterfall, which is where auth
 * injection, retry, rate limiting and caching hook in M2 — the hook is live in
 * M1 with no listeners, so those plugins arrive to something that already
 * works (docs/02 §5).
 *
 * See docs/04-core-services.md §2 and docs/11 §4.5.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { NetworkError } from '@BBeBee/protocol'
import type {
  Cookie,
  CookieJar,
  CookieJarService,
  HttpRequest,
  HttpResponse,
  Uri,
} from '@BBeBee/protocol'

export interface HttpNodeConfig {
  /** Transport. Defaults to the runtime's `fetch`. */
  fetch?: typeof fetch
  /** Applied when a request does not set its own. */
  defaultTimeoutMs?: number
  /** Sent on every request unless overridden. */
  userAgent?: string
}

export class HttpNode extends Service {
  static inject = ['fs']

  private readonly config: Required<Omit<HttpNodeConfig, 'fetch'>> & { fetch: typeof fetch }
  readonly cookies: CookieJarService

  constructor(ctx: Context, config: HttpNodeConfig = {}) {
    super(ctx, 'http')
    this.config = {
      fetch: config.fetch ?? globalThis.fetch.bind(globalThis),
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30_000,
      userAgent: config.userAgent ?? 'BBeBee/0.1',
    }
    this.cookies = new MemoryJars()
  }

  /** `ctx.http(req)`. Cordis calls this for the service's own call signature. */
  protected [Service.invoke](req: HttpRequest): Promise<HttpResponse> {
    return this.request(req)
  }

  /**
   * The one place a request actually goes out.
   *
   * Dispatched as a waterfall so a listener can rewrite the request, answer it
   * from a cache, or retry it — without this service knowing any of those
   * exist.
   */
  request(req: HttpRequest): Promise<HttpResponse> {
    // The terminal takes no arguments: `next` is closed over the original
    // request, so a listener rewrites it by mutating `req` in place. The
    // object here is the one every listener saw (docs/07 §5).
    return this.ctx.waterfall('http/request', req, () => this.send(req))
  }

  async get<T>(url: string, init: Omit<HttpRequest, 'url' | 'method'> = {}): Promise<T> {
    const response = await this.request({ ...init, url, method: 'GET' })
    return response.json<T>()
  }

  async post<T>(
    url: string,
    body: unknown,
    init: Omit<HttpRequest, 'url' | 'method' | 'body'> = {},
  ): Promise<T> {
    const response = await this.request({
      ...init,
      url,
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...init.headers },
    })
    return response.json<T>()
  }

  /**
   * Stream a URL to a file, resuming where asked.
   *
   * Written now rather than at M3 because it is the same code either way, and
   * because a `download` that exists only as a signature is the kind of
   * half-member docs/06 §1.1 warns about. The *policy* around it — the task
   * queue, the checkpoints, `wifi_only` — is M3's and lives in
   * `plugin-download`.
   */
  async download(
    req: HttpRequest & { to: Uri; resumeFrom?: number },
  ): Promise<{ bytes: number; etag?: string }> {
    const headers = { ...req.headers }
    if (req.resumeFrom) headers['range'] = `bytes=${req.resumeFrom}-`

    const response = await this.request({ ...req, headers, method: req.method ?? 'GET' })
    if (response.status >= 400) {
      throw new NetworkError(`download failed: ${response.status} for ${req.url}`)
    }

    const append = Boolean(req.resumeFrom) && response.status === 206
    const writer = this.ctx.fs.createWriteStream(req.to, { append }).getWriter()
    const reader = response.stream().getReader()
    let bytes = req.resumeFrom && append ? req.resumeFrom : 0

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await writer.write(value)
        bytes += value.byteLength
        req.onProgress?.(bytes, contentLengthOf(response, req.resumeFrom))
      }
      await writer.close()
    } catch (error) {
      await writer.abort(error).catch(() => undefined)
      throw error
    }

    const etag = response.headers['etag']
    return { bytes, ...(etag ? { etag } : {}) }
  }

  private async send(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController()
    const timeoutMs = req.timeoutMs ?? this.config.defaultTimeoutMs
    const timer =
      timeoutMs > 0 ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs) : undefined
    const onAbort = () => controller.abort(req.signal?.reason)
    req.signal?.addEventListener('abort', onAbort)

    try {
      const response = await this.config.fetch(req.url, {
        method: req.method ?? 'GET',
        headers: { 'user-agent': this.config.userAgent, ...req.headers },
        ...(req.body !== undefined ? { body: req.body as BodyInit } : {}),
        redirect: req.redirect ?? 'follow',
        signal: controller.signal,
      })
      return wrap(response, req.onProgress)
    } catch (error) {
      // Transport failures are `NetworkError`, which is the one class the
      // player retries with backoff (docs/06 §6).
      throw new NetworkError(
        error instanceof Error ? error.message : String(error),
        undefined,
        { cause: error },
      )
    } finally {
      if (timer) clearTimeout(timer)
      req.signal?.removeEventListener('abort', onAbort)
    }
  }
}

function contentLengthOf(response: HttpResponse, resumeFrom?: number): number | undefined {
  const raw = response.headers['content-length']
  if (!raw) return undefined
  const length = Number(raw)
  return Number.isFinite(length) ? length + (resumeFrom ?? 0) : undefined
}

/** `Response` → the contract's shape, with progress if anyone asked. */
function wrap(response: Response, onProgress?: HttpRequest['onProgress']): HttpResponse {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  const total = Number(response.headers.get('content-length') ?? '') || undefined

  return {
    status: response.status,
    headers,
    url: response.url,
    text: () => response.text(),
    json: <T>() => response.json() as Promise<T>,
    bytes: async () => new Uint8Array(await response.arrayBuffer()),
    stream: () => {
      const body = response.body
      if (!body) return emptyStream()
      if (!onProgress) return body
      let loaded = 0
      return body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            loaded += chunk.byteLength
            onProgress(loaded, total)
            controller.enqueue(chunk)
          },
        }),
      )
    },
  }
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

/* ── cookies ────────────────────────────────────────────────────────────── */

/**
 * In-memory jars.
 *
 * ⚠️ **Not persisted.** Session persistence is M2's, and it is not a detail:
 * the shipped desktop jar is Chromium's own store behind a `persist:`
 * partition, and the mobile one is envelope-encrypted (docs/04 §2.1). This
 * exists so the member is not a hole in the contract during M1, when nothing
 * authenticates — a jar that forgets on restart is honest about being empty;
 * one that *pretends* to persist would not be.
 */
class MemoryJars implements CookieJarService {
  private readonly jars = new Map<string, MemoryJar>()

  jar(name: string): CookieJar {
    let jar = this.jars.get(name)
    if (!jar) {
      jar = new MemoryJar(name)
      this.jars.set(name, jar)
    }
    return jar
  }

  async destroy(name: string): Promise<void> {
    this.jars.delete(name)
  }

  async list(): Promise<string[]> {
    return [...this.jars.keys()]
  }
}

class MemoryJar implements CookieJar {
  readonly ready = Promise.resolve()
  private cookies: Cookie[] = []

  constructor(readonly name: string) {}

  async get(url: string): Promise<Cookie[]> {
    const host = hostOf(url)
    const now = Date.now()
    // Expired cookies are dropped rather than replayed, which otherwise
    // produces a confusing "logged in but every request fails" state.
    this.cookies = this.cookies.filter((c) => !c.expiresAt || c.expiresAt > now)
    return this.cookies.filter((c) => host.endsWith(c.domain.replace(/^\./, '')))
  }

  async set(cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      const at = this.cookies.findIndex(
        (c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path,
      )
      if (at >= 0) this.cookies[at] = cookie
      else this.cookies.push(cookie)
    }
  }

  async all(): Promise<Cookie[]> {
    return [...this.cookies]
  }

  async remove(name: string, domain?: string): Promise<void> {
    this.cookies = this.cookies.filter(
      (c) => !(c.name === name && (domain === undefined || c.domain === domain)),
    )
  }

  async clear(): Promise<void> {
    this.cookies = []
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export const name = 'core-http-node'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.http` is usable.
 */
export async function apply(ctx: Context, config: HttpNodeConfig = {}) {
  const fiber = await ctx.plugin(HttpNode, config)
  return () => void fiber.dispose()
}

export default { name, apply }
