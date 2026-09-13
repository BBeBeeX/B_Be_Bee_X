/**
 * The rule tracer — docs/06 §10, and the reason a rotted source is repairable
 * rather than merely broken.
 *
 * A trace is streamed rather than collected and returned, because the step it
 * most needs to explain is the one that is *still running*: a request to a
 * server that has stopped answering shows as an `http` line with no status and
 * nothing after it, which is the whole diagnosis. A collected trace would show
 * nothing at all until it gave up.
 *
 * Everything user-derived is `Redacted` by construction. A trace is what
 * someone pastes into a forum thread asking a source author for help, and a
 * Subsonic URL carries a password hash and its salt as a matter of routine.
 */

import { redactForTrace, redactUrl } from '@BBeBee/protocol'
import type { HttpRequest, HttpResponse, HttpService, TraceEvent } from '@BBeBee/protocol'

/**
 * An async queue: producers push, one consumer iterates.
 *
 * Written out rather than reached for as a dependency because the semantics
 * matter and are small: pushing never blocks (a slow reader must not slow the
 * run being traced), and closing ends the iteration rather than hanging it.
 */
export class TraceCollector {
  private readonly buffer: TraceEvent[] = []
  private waiting: ((value: IteratorResult<TraceEvent>) => void) | undefined
  private closed = false

  /**
   * Values that must never appear in a trace, whatever they look like.
   *
   * ⚠️ Public, because `tracedHttp` needs them too. Redaction by *shape*
   * catches `t=` and `password=`; only the values themselves catch a
   * credential a document chose to put somewhere unremarkable — and the HTTP
   * lines were being redacted structurally and not by value, so a password in
   * a path segment or an unrecognised parameter went straight into a trace
   * meant to be pasted into a forum thread.
   */
  constructor(readonly secrets: readonly string[] = []) {}

  push(event: TraceEvent): void {
    if (this.closed) return
    const waiter = this.waiting
    if (waiter) {
      this.waiting = undefined
      waiter({ value: event, done: false })
      return
    }
    this.buffer.push(event)
  }

  /** An error, redacted and attributed to where it happened when known. */
  error(error: unknown, site?: { block?: string; field?: string }): void {
    this.push({
      at: Date.now(),
      kind: 'error',
      message: redactForTrace(messageOf(error), this.secrets),
      ...(site?.block ? { block: site.block } : {}),
      ...(site?.field ? { field: site.field } : {}),
    })
  }

  result(summary: string): void {
    this.push({ at: Date.now(), kind: 'result', summary: redactForTrace(summary, this.secrets) })
  }

  /** A line the document printed itself — `src.log(...)` in an `@js:` block. */
  log(message: string): void {
    this.push({
      at: Date.now(),
      kind: 'log',
      message: redactForTrace(message, this.secrets),
    })
  }

  /**
   * A whole value worth reading — an HTTP response body, a debug script's
   * return value. Capped far more generously than a rule preview, because on
   * the test screen the body *is* what the user came to read.
   */
  value(label: string, value: unknown): void {
    this.push({
      at: Date.now(),
      kind: 'value',
      label,
      value: redactForTrace(valueTextOf(value), this.secrets),
    })
  }

  close(): void {
    this.closed = true
    const waiter = this.waiting
    if (waiter) {
      this.waiting = undefined
      waiter({ value: undefined, done: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TraceEvent> {
    for (;;) {
      const buffered = this.buffer.shift()
      if (buffered) {
        yield buffered
        continue
      }
      // Drain before closing, so the last events of a finished run are not
      // lost to the race between the producer closing and the reader arriving.
      if (this.closed) return
      const next = await new Promise<IteratorResult<TraceEvent>>((resolve) => {
        this.waiting = resolve
      })
      if (next.done) return
      yield next.value
    }
  }
}

/**
 * Wrap an HTTP service so every request becomes a trace line.
 *
 * The line is emitted **after** the response, carrying the status and the
 * duration — but a request that never answers still shows, because the failure
 * is reported as an `http` line with status 0 rather than vanishing.
 */
export function tracedHttp(http: HttpService, collector: TraceCollector): HttpService {
  const traced = async (request: HttpRequest): Promise<HttpResponse> => {
    const started = Date.now()
    try {
      const response = await http(request)
      /*
       * `text()` is consumed once by the caller, so the tracer cannot read the
       * body to measure it without stealing it. The header is used where the
       * server sent one and the line says 0 otherwise — an honest unknown
       * beats a number nobody can act on.
       */
      const declared = Number(response.headers['content-length'] ?? 0)
      collector.push({
        at: Date.now(),
        kind: 'http',
        method: request.method ?? 'GET',
        url: redactUrl(response.url || request.url, collector.secrets),
        status: response.status,
        ms: Date.now() - started,
        bytes: Number.isFinite(declared) ? declared : 0,
      })
      return response
    } catch (error) {
      collector.push({
        at: Date.now(),
        kind: 'http',
        method: request.method ?? 'GET',
        url: redactUrl(request.url, collector.secrets),
        // Not a status the server sent: the request did not complete. Zero is
        // the conventional "no response", and the error line that follows says
        // what actually happened.
        status: 0,
        ms: Date.now() - started,
        bytes: 0,
      })
      throw error
    }
  }
  return traced as unknown as HttpService
}

/** Cap on a whole value — a body, an output, a return value shown on the test screen. */
const VALUE = 20_000

/** The full text of a value, within the whole-value cap. */
function valueTextOf(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, VALUE)
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.slice(0, VALUE)
  } catch {
    return String(value).slice(0, VALUE)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
