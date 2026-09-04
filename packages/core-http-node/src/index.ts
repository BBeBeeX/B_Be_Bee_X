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
import { assertHost } from '@BBeBee/kernel'
import { CapabilityError, NetworkError } from '@BBeBee/protocol'
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
  /**
   * How long a download may go without receiving a byte.
   *
   * The request timeout covers headers only: a server that answers and then
   * stops sending would otherwise hold the transfer open indefinitely, which
   * on mobile means holding a wake lock indefinitely too.
   */
  stallTimeoutMs?: number
  /** Sent on every request unless overridden. */
  userAgent?: string
}

/**
 * Redirect hops we will follow before giving up.
 *
 * Matches what `fetch` allows, so raising the check to our own loop does not
 * change behaviour for honest servers.
 */
const MAX_REDIRECTS = 20

/** Schemes a redirect may lead to. Anything else is refused, not followed. */
const FOLLOWABLE_SCHEMES = new Set(['http:', 'https:'])

export class HttpNode extends Service {
  static inject = ['fs']

  private readonly config: Required<Omit<HttpNodeConfig, 'fetch'>> & { fetch: typeof fetch }
  readonly cookies: CookieJarService

  constructor(ctx: Context, config: HttpNodeConfig = {}) {
    super(ctx, 'http')
    this.config = {
      fetch: config.fetch ?? globalThis.fetch.bind(globalThis),
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30_000,
      stallTimeoutMs: config.stallTimeoutMs ?? 60_000,
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
  // `async` deliberately: a refused host must arrive as a *rejection* like
  // every other failure, not as a synchronous throw that callers would have to
  // wrap separately.
  async request(req: HttpRequest): Promise<HttpResponse> {
    // The `net:host/<glob>` gate, before anything else — including before the
    // waterfall, so a listener cannot be used to launder a host the caller was
    // never granted. Ungated callers (the kernel, core services, tests) pass
    // through; a plugin is held to its manifest. Without this the grant was a
    // manifest string with no meaning, exactly as `db:own` once was.
    assertHost(this[Service.resolveConfig](), req.url)
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
        const { done, value } = await withStallTimeout(
          reader.read(),
          this.config.stallTimeoutMs,
          req.url,
        )
        if (done) break
        await writer.write(value)
        bytes += value.byteLength
        req.onProgress?.(bytes, contentLengthOf(response, append ? (req.resumeFrom ?? 0) : 0))
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
      return await this.followRedirects(req, controller)
    } catch (error) {
      // A capability refusal is not a transport failure. It has to propagate
      // as itself: `NetworkError` is the one class the player retries with
      // backoff (docs/06 §7), so wrapping it would turn a blocked request into
      // an endlessly retried one and hide *why* it was blocked. This matters
      // now that the host check runs per redirect hop, inside this try.
      if (error instanceof CapabilityError) throw error
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

  private async followRedirects(
    req: HttpRequest,
    controller: AbortController,
  ): Promise<HttpResponse> {
    const mode = req.redirect ?? 'follow'
    let url = req.url

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Every hop, not just the first. A listener may also have rewritten the
      // URL during the waterfall, and the rewritten host must be granted too.
      assertHost(this[Service.resolveConfig](), url)

      const response = await this.config.fetch(url, {
        method: req.method ?? 'GET',
        headers: { 'user-agent': this.config.userAgent, ...req.headers },
        ...(req.body !== undefined ? { body: req.body as BodyInit } : {}),
        // Always manual: following internally would skip the check above.
        redirect: 'manual',
        signal: controller.signal,
      })

      const status = response.status
      const isRedirectStatus = status >= 300 && status < 400 && status !== 304
      const location = response.headers.get('location')

      // `redirect: 'error'` rejects on *any* redirect status, with or without
      // a Location — that is what `fetch` does, and a caller who asked to be
      // told about redirects is not served by silently handing back a 302 that
      // happened to be malformed.
      if (isRedirectStatus && mode === 'error') {
        throw new NetworkError(`unexpected ${status} redirect from ${url}`)
      }
      if (!isRedirectStatus || !location || mode !== 'follow') {
        return wrap(response, req.onProgress)
      }

      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw new NetworkError(`malformed redirect from ${url}: ${location}`)
      }
      // A redirect may move hosts; it may not move *schemes* into something
      // that reads local state. `file:` and `data:` are refused by undici
      // today, but this transport is meant to be swappable — and a scheme
      // check is one line against a class of bug that is very hard to see.
      if (!FOLLOWABLE_SCHEMES.has(next.protocol)) {
        throw new NetworkError(`refusing a ${next.protocol} redirect from ${url}`)
      }
      // Discard the redirect body — it is never read, and leaving it
      // unconsumed pins the connection until GC. `cancel()` releases the
      // stream; it does not drain it, so the socket may or may not be
      // reusable, which is the transport's business rather than ours.
      await response.body?.cancel().catch(() => {})
      url = next.href
    }

    throw new NetworkError(`too many redirects: ${req.url}`)
  }
}

/**
 * The expected total, given what the server actually did.
 *
 * `resumeFrom` is only part of the total when the server honoured the range
 * (206). A server that ignored it sends the whole body with a 200, and adding
 * the offset then reports a total larger than the file — a progress bar that
 * never reaches the end.
 */
/** Reject if a chunk does not arrive in time, so a dead stream is an error. */
async function withStallTimeout<T>(work: Promise<T>, ms: number, url: string): Promise<T> {
  if (ms <= 0) return work
  let timer: ReturnType<typeof setTimeout> | undefined
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new NetworkError(`download stalled for ${ms}ms: ${url}`)),
      ms,
    )
  })
  try {
    return await Promise.race([work, stalled])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function contentLengthOf(response: HttpResponse, alreadyHave: number): number | undefined {
  const raw = response.headers['content-length']
  if (!raw) return undefined
  const length = Number(raw)
  return Number.isFinite(length) ? length + alreadyHave : undefined
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
    // A bare `endsWith` sends example.com's cookie to evilexample.com. The
    // boundary is a dot, or an exact match — RFC 6265 §5.1.3.
    return this.cookies.filter((c) => {
      const domain = c.domain.replace(/^\./, '').toLowerCase()
      return host === domain || host.endsWith(`.${domain}`)
    })
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
