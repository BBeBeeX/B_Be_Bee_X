/**
 * `plugin-source-runtime` — the one interpreter of source documents.
 *
 * It claims no service key. It reads the `sources` table through
 * `ctx.sources`, and registers one `MediaProvider` per enabled row. Sources
 * are rows; this is the only thing that turns one into something playable, and
 * there is no second interpreter to keep in step.
 *
 * **A source is not a plugin — but each one gets a fiber anyway.** That is
 * what makes disabling one total and free of bespoke cleanup: its isolated
 * `ctx.http` scope (its own cookie jar, its own rate limit, its own host
 * allowlist) and its registration go when the fiber goes. See docs/06 §4.1.
 *
 * This is the M1 slice (docs/11 MD-7): documents are stored, given fibers, and
 * resolved to streams. The rule language beyond `=` templates, the sandbox,
 * login, search and the tracer land with M2.
 */

import type { Context } from 'cordis'
// Pulls the service and event augmentations (`ctx.sources`, `source/*`) into
// this program. Without it a consumer compiling in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'
import type { Disposable, SourceRecord } from '@BBeBee/protocol'
import { DocumentSource } from './source.js'
import { parseRate } from './capabilities.js'

export interface SourceRuntimeConfig {
  /**
   * Applied to a source whose document states no `concurrentRate`.
   *
   * Conservative on purpose: the failure mode of guessing high is the user's
   * own server rate-limiting or banning them, which looks like the app being
   * broken (docs/06 §4.3).
   */
  defaultRate?: string
}

/**
 * Everything one live source owns.
 *
 * Held so that a change to one document tears down exactly that source and
 * nothing else — the user sees the edit on the next play, with no restart.
 */
interface LiveSource {
  record: SourceRecord
  dispose: Disposable
}

export class SourceRuntime {
  private readonly live = new Map<string, LiveSource>()

  constructor(
    private readonly ctx: Context,
    private readonly config: SourceRuntimeConfig = {},
  ) {}

  /** Bring every enabled source up, and keep the set in step with the table. */
  async start(): Promise<Disposable> {
    await this.sync()

    const off = [
      this.ctx.on('source/imported', () => void this.sync()),
      this.ctx.on('source/changed', (id) => void this.reload(id)),
      this.ctx.on('source/removed', (id) => void this.stop(id)),
    ]

    return () => {
      for (const dispose of off) dispose()
      for (const id of [...this.live.keys()]) this.stop(id)
    }
  }

  /** Start what should be running, stop what should not. */
  private async sync(): Promise<void> {
    const wanted = new Map(
      this.ctx.sources.sources.filter((r) => r.enabled).map((r) => [r.id, r] as const),
    )

    for (const [id, current] of this.live) {
      const next = wanted.get(id)
      // A document that did not change keeps its fiber: rebuilding it would
      // drop a warm cookie jar for nothing.
      if (!next) this.stop(id)
      else if (next.docHash !== current.record.docHash) this.replace(next)
    }
    for (const [id, record] of wanted) {
      if (!this.live.has(id)) this.startOne(record)
    }
  }

  private reload(id: string): void {
    const record = this.ctx.sources.source(id)
    if (!record || !record.enabled) {
      this.stop(id)
      return
    }
    this.replace(record)
  }

  private replace(record: SourceRecord): void {
    this.stop(record.id)
    this.startOne(record)
  }

  /**
   * Give one source its own HTTP stack and register it.
   *
   * `ctx.isolate('http')` is what makes two Navidrome servers unable to see
   * each other's cookies, and one slow source unable to stall another's
   * requests. Every other service stays shared, because only the named key is
   * isolated (docs/03 §5).
   */
  private startOne(record: SourceRecord): void {
    const scoped = this.ctx.isolate('http')
    const rateLimit = parseRate(record.doc.concurrentRate ?? this.config.defaultRate)

    // The scope carries the source's own storage namespace and egress
    // allowlist: `net:host/*` is held by this plugin because the hosts are not
    // known until a document is imported, and it is narrowed here, per source,
    // to what that document declared (docs/03 §7, docs/06 §8).
    const sourceCtx = scoped.intercept('http', {
      scopeId: record.id,
      jar: record.id,
      allowedHosts: [...record.allowedHosts],
      ...(rateLimit ? { rateLimit } : {}),
    })

    const source = new DocumentSource(record, {
      http: sourceCtx.http,
      trackPayload: (id) => this.trackPayload(record.id, id),
    })

    const off = sourceCtx.sources.register(source.provider())
    this.live.set(record.id, {
      record,
      // Wrapped in a local closure: the disposer that came back through the
      // service proxy is not the one a fiber would collect (docs/03 §2).
      dispose: () => off(),
    })
  }

  private stop(id: string): void {
    const current = this.live.get(id)
    if (!current) return
    this.live.delete(id)
    current.dispose()
  }

  /**
   * The raw payload a search stored for this track.
   *
   * This is why `tracks.raw_json` exists: `ruleStream` runs hours after the
   * search that produced the track, possibly offline, and must not re-run it.
   */
  private async trackPayload(
    sourceId: string,
    trackId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const row = await this.ctx.db.get<{ raw_json: string | null }>(
      'SELECT raw_json FROM tracks WHERE urn = ?',
      [`BBeBee:${sourceId}:track:${trackId}`],
    )
    if (!row?.raw_json) return undefined
    try {
      const parsed: unknown = JSON.parse(row.raw_json)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }
}

export { DocumentSource } from './source.js'
export { capabilitiesFor, parseRate } from './capabilities.js'

export const name = 'plugin-source-runtime'
export const inject = ['http', 'db', 'sources']

/**
 * ⚠️ `async` is not decoration. Cordis decides "is this a class?" with
 * `!!func.prototype`, and a plain `function apply(…)` has one — so it would be
 * `new`-ed and the disposer returned here discarded, leaving every source
 * registered forever after unload. An async function has no prototype.
 * `conventions.test.ts` fails the build on the other shape.
 */
export async function apply(ctx: Context, config: SourceRuntimeConfig = {}) {
  const runtime = new SourceRuntime(ctx, config)
  const stop = await runtime.start()
  return () => stop()
}

export default { name, inject, apply }
