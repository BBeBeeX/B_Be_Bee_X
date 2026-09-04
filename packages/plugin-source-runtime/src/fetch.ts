/**
 * Fetching the document a rule is evaluated against.
 *
 * A rule that produces a URL may instead produce a **URL object**: the URL, a
 * comma, and a JSON options blob. That is legado's syntax, kept because it is
 * compact enough to live in a form field on a phone (docs/06 §3.5):
 *
 *     https://api.example.org/search,{"method":"POST","body":"q={{key}}"}
 *
 * ⚠️ Splitting on the comma is not as simple as it looks: a URL may contain
 * commas, and a body certainly may. The split is at the *first* comma that is
 * followed by something parsing as a JSON object — anything else is part of
 * the URL.
 */

import { NetworkError, ProviderError, RateLimitError, AuthError, NotFoundError } from '@BBeBee/protocol'
import type { HttpRequest, HttpService } from '@BBeBee/protocol'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'HEAD'
  body?: string
  headers?: Record<string, string>
  /** Decode a non-UTF-8 response. Recorded; honoured where the host can. */
  charset?: string
  retry?: number
}

export interface ParsedUrl {
  url: string
  options: RequestOptions
}

/**
 * Split a rendered rule into a URL and its options.
 *
 * Tolerant on purpose: a document whose options blob is malformed gets the
 * whole string treated as a URL, which fails as a bad request naming the URL
 * rather than as a parse error naming nothing.
 */
export function parseUrlObject(rendered: string): ParsedUrl {
  const text = rendered.trim()

  for (let i = text.indexOf(','); i !== -1; i = text.indexOf(',', i + 1)) {
    const tail = text.slice(i + 1).trim()
    if (!tail.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(tail)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { url: text.slice(0, i).trim(), options: normalise(parsed as Record<string, unknown>) }
      }
    } catch {
      // Not an options blob after all — this comma belongs to the URL.
    }
  }
  return { url: text, options: {} }
}

function normalise(raw: Record<string, unknown>): RequestOptions {
  const out: RequestOptions = {}
  const method = typeof raw.method === 'string' ? raw.method.toUpperCase() : undefined
  if (method === 'GET' || method === 'POST' || method === 'HEAD') out.method = method
  if (typeof raw.body === 'string') out.body = raw.body
  if (typeof raw.charset === 'string') out.charset = raw.charset
  if (typeof raw.retry === 'number' && raw.retry > 0) out.retry = Math.min(raw.retry, 5)
  if (raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)) {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.headers)) {
      if (typeof v === 'string') headers[k] = v
    }
    if (Object.keys(headers).length > 0) out.headers = headers
  }
  return out
}

/** A fetched document, parsed as far as its content type allows. */
export interface FetchedDocument {
  /** Parsed JSON, or the raw text when it is not JSON. */
  value: unknown
  text: string
  /** The URL after redirects — what a relative link in the body resolves against. */
  baseUrl: string
  status: number
}

/**
 * Fetch and parse.
 *
 * JSON is parsed; anything else is handed on as text, because the regex engine
 * works on text and the markup engines will parse it themselves when they
 * land. A body that claims to be JSON and is not comes back as text rather
 * than as an error — a backend serving an HTML error page with a JSON
 * content type is common, and the rule that then finds nothing is a better
 * diagnostic than a parse failure two layers down.
 */
export async function fetchDocument(
  http: HttpService,
  target: ParsedUrl,
  extraHeaders: Record<string, string> | undefined,
  sourceId: string,
): Promise<FetchedDocument> {
  const request: HttpRequest = {
    url: target.url,
    method: target.options.method ?? 'GET',
    ...(target.options.body !== undefined ? { body: target.options.body } : {}),
    ...(extraHeaders || target.options.headers
      ? { headers: { ...extraHeaders, ...target.options.headers } }
      : {}),
  }

  // Not wrapped: whatever `ctx.http` throws is already in the taxonomy — a
  // capability refusal, a transport failure — and re-wrapping it would flatten
  // a `CapabilityError` into something retryable.
  const response = await http(request)

  if (response.status >= 400) throw statusError(response.status, target.url, sourceId)

  const text = await response.text()
  const contentType = response.headers['content-type'] ?? ''
  let value: unknown = text
  if (contentType.includes('json') || looksLikeJson(text)) {
    try {
      value = JSON.parse(text)
    } catch {
      value = text
    }
  }

  return { value, text, baseUrl: response.url || target.url, status: response.status }
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

/**
 * A status code, as the error class the player branches on.
 *
 * The same mapping `resolveStream`'s probe uses, and for the same reason: a
 * 401 that reads as "not found" skips the re-login path, and a 500 that reads
 * as non-retryable turns a blip into a stopped queue (docs/06 §7).
 */
export function statusError(status: number, url: string, sourceId: string): Error {
  if (status === 404 || status === 410) return new NotFoundError(`${status} for ${url}`, sourceId)
  if (status === 401 || status === 403) return new AuthError(`${status} for ${url}`, sourceId)
  if (status === 429) return new RateLimitError(`rate limited by ${hostOf(url)}`, 60_000, sourceId)
  if (status >= 500) return new NetworkError(`${status} from ${url}`, sourceId)
  return new ProviderError(`${status} for ${url}`, sourceId)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
