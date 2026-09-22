/**
 * In-memory ring buffer backing the in-app log viewer.
 *
 * Cordis keeps its own small buffer, but this one is normalised, redacted, and
 * queryable — the shape the log-viewer UI and the crash reporter both want.
 * See docs/04-core-services.md §16.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { formatLogArguments, levelName, type LogLevel, type LogRecord } from '@BBeBee/protocol'

export interface LogBufferConfig {
  /** Entries retained. Oldest are dropped first. */
  size?: number
  level?: number
}

export interface LogQuery {
  level?: LogLevel
  scope?: string
  /** Case-insensitive substring over the message. */
  contains?: string
  since?: number
  limit?: number
}

export class LogBuffer extends Service {
  private readonly entries: LogRecord[] = []
  private readonly size: number
  private readonly maxLevel: number

  constructor(ctx: Context, config: LogBufferConfig = {}) {
    super(ctx, 'logBuffer')
    this.size = config.size ?? 2000
    this.maxLevel = config.level ?? 3
  }

  /**
   * Register the exporter from inside the service.
   *
   * Not from the enclosing plugin: a context that *provides* a service may not
   * read it back without declaring `inject`, so an exporter closing over
   * `ctx.logBuffer` throws "cannot get property without inject" on the first
   * log line. Holding `this` sidesteps the question entirely.
   */
  async [Service.init]() {
    return this.ctx.logger.exporter({
      export: (message) => {
        if (message.level > this.maxLevel) return
        const { fullMessage, unused } = formatLogArguments(message.args as unknown[])
        this.push({
          sn: message.sn,
          time: message.ts,
          level: levelName(message.level),
          scope: message.name,
          message: fullMessage,
          ...(unused.length ? { meta: { args: unused } } : {}),
        })
      },
    })
  }

  push(record: LogRecord): void {
    this.entries.push(record)
    // Ring, not unbounded: a long session must not become a memory leak.
    if (this.entries.length > this.size) {
      this.entries.splice(0, this.entries.length - this.size)
    }
  }

  /** Newest first, since that is what a log viewer opens on. */
  query(q: LogQuery = {}): LogRecord[] {
    const limit = q.limit ?? 200
    const needle = q.contains?.toLowerCase()
    const out: LogRecord[] = []

    for (let i = this.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const entry = this.entries[i]!
      if (q.level && entry.level !== q.level) continue
      if (q.scope && entry.scope !== q.scope) continue
      if (q.since !== undefined && entry.time < q.since) continue
      if (needle && !entry.message.toLowerCase().includes(needle)) continue
      out.push(entry)
    }
    return out
  }

  get all(): readonly LogRecord[] {
    return this.entries
  }

  clear(): void {
    this.entries.length = 0
  }

  /** Everything, oldest first, as NDJSON — what a crash report attaches. */
  toNdjson(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n')
  }
}

declare module 'cordis' {
  interface Context {
    logBuffer: LogBuffer
  }
}

export const name = 'plugin-log-buffer'

/**
 * Awaited deliberately.
 *
 * A wrapper that fires `ctx.plugin()` without awaiting resolves immediately,
 * so `await ctx.plugin(thisPlugin)` tells a caller nothing about whether the
 * service inside is ready — its async `Service.init` may still be running.
 * Awaiting propagates readiness to whoever loaded us.
 */
export async function apply(ctx: Context, config: LogBufferConfig = {}) {
  const fiber = await ctx.plugin(LogBuffer, config)
  return () => void fiber.dispose()
}

export default { name, apply }
