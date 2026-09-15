/** `ctx.http` — outbound HTTP and persistent cookie jars. See docs/04-core-services.md §2. */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Uri } from '../common.js'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH'

export interface HttpRequest {
  url: string
  method?: HttpMethod
  headers?: Record<string, string>
  body?: string | Uint8Array | FormData
  signal?: AbortSignal
  timeoutMs?: number
  redirect?: 'follow' | 'manual' | 'error'
  /** Named cookie jar. Provider instances get their own via `ctx.isolate('http')`. */
  jar?: string
  onProgress?: (loaded: number, total?: number) => void
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  /** Final URL, after redirects. */
  url: string
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  bytes(): Promise<Uint8Array>
  stream(): ReadableStream<Uint8Array>
}

export interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  /** Epoch ms. Absent means a session cookie. */
  expiresAt?: number
  secure: boolean
  httpOnly: boolean
  sameSite?: 'strict' | 'lax' | 'none'
}

/**
 * A persistent, per-instance cookie jar.
 *
 * Signing in once must be enough: the jar is rehydrated at startup so a
 * cookie-backed session survives a restart with no stored password.
 * See docs/06-music-sources.md §4.1.
 */
export interface CookieJar {
  readonly name: string
  /**
   * Resolves once the persisted jar has loaded. Await this before the first
   * request, or a cold start races an empty jar into a spurious 401.
   */
  readonly ready: Promise<void>
  get(url: string): Promise<Cookie[]>
  set(cookies: Cookie[]): Promise<void>
  /** Every cookie, for export or inspection. Never logged. */
  all(): Promise<Cookie[]>
  remove(name: string, domain?: string): Promise<void>
  /** Empties the jar AND deletes its persisted copy. Called by `signOut()`. */
  clear(): Promise<void>
  /**
   * Resolve once every queued save has landed.
   *
   * Saves are queued rather than awaited by `set` — a slow disk must not slow
   * a request — so anything that needs to *observe* the stored bytes has to
   * wait for them: an export, a backup, a sign-out audit. An implementation
   * that writes synchronously satisfies this with `Promise.resolve()`.
   */
  flush(): Promise<void>
}

export interface CookieJarService {
  /** Returns the named jar, creating and rehydrating it on first access. */
  jar(name: string): CookieJar
  /** Forget a jar entirely, including its stored bytes. */
  destroy(name: string): Promise<void>
  list(): Promise<string[]>
}

/**
 * A transfer to a local file.
 *
 * `onResponse` is what a resuming caller needs and nothing else gives it: the
 * `etag` identifies the remote version *now*, before the body is streamed, so
 * a changed file can be restarted rather than spliced. A caller that resumes
 * with the stored `etag` as `If-Range` gets correctness from the server side;
 * one that wants to decide itself reads it here.
 */
export interface DownloadRequest extends HttpRequest {
  /** The local file the body is written to. */
  to: Uri
  /** Byte offset to append from, sent as a `Range` header. */
  resumeFrom?: number
  /** Called once the headers arrive, before any body byte is written. */
  onResponse?: (info: { etag?: string; total?: number }) => void
}

export interface HttpService {
  (req: HttpRequest): Promise<HttpResponse>
  get<T>(url: string, init?: Omit<HttpRequest, 'url' | 'method'>): Promise<T>
  post<T>(
    url: string,
    body: unknown,
    init?: Omit<HttpRequest, 'url' | 'method' | 'body'>,
  ): Promise<T>
  /** Download to a Uri with resume support. Used by `plugin-download`. */
  download(req: DownloadRequest): Promise<{ bytes: number; etag?: string }>
  readonly cookies: CookieJarService
}

declare module 'cordis' {
  interface Context {
    http: HttpService
  }
}
