/**
 * Rotating NDJSON log file, written through `ctx.fs`.
 *
 * NDJSON rather than formatted text because the file exists to be *read back*
 * — by the crash reporter, and by whoever is triaging a bug report.
 *
 * See docs/04-core-services.md §16.
 */

import type { Context } from 'cordis'
import {
  formatLogArguments,
  levelName,
  type FsService,
  type LogRecord,
  type Uri,
} from '@BBeBee/protocol'

export interface LogFileConfig {
  /** 0=error, 1=warn, 2=info, 3=debug. */
  level?: number
  /** Rotate once the active file passes this size. */
  maxBytes?: number
  /** Rotated files kept, oldest deleted first. */
  maxFiles?: number
  /** Batch window. Writing per line would thrash the filesystem. */
  flushDelayMs?: number
  fileName?: string
}

export const name = 'plugin-log-file'
export const inject = ['fs', 'paths']

/**
 * ⚠️ `async` is load-bearing, not decoration.
 *
 * Cordis decides "is this a class?" with `!!func.prototype`. A plain
 * `function apply(…)` has one, so it is `new`-ed as if it were a service and
 * the disposer it returns is discarded — the plugin loads, works, and never
 * unloads. An async function has no prototype. `conventions.test.ts` fails the
 * build on the other shape (docs/03 §2).
 */
export async function apply(ctx: Context, config: LogFileConfig = {}) {
  const maxLevel = config.level ?? 2
  const maxBytes = config.maxBytes ?? 2 * 1024 * 1024
  const maxFiles = config.maxFiles ?? 3
  const flushDelayMs = config.flushDelayMs ?? 1000
  const fileName = config.fileName ?? 'app.log'

  let queued: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let writing: Promise<void> = Promise.resolve()
  let disposed = false

  /**
   * Captured **only for the final flush**. See docs/03 §4, "The one exception".
   *
   * A disposer runs while its own fiber is already UNLOADING, so reaching
   * through the context there throws `cannot get required service in inactive
   * context` and the shutdown flush loses exactly the records you wanted.
   *
   * Every other write reads `ctx.fs` fresh — condition 2 of the rule — so that
   * a plugin running under an isolated or intercepted `fs` writes where that
   * scope says, not where the service happened to point at load time.
   */
  const fsAtLoad = ctx.fs
  let cachedUri: Uri | undefined

  async function logUri(fs: FsService): Promise<Uri> {
    if (cachedUri) return cachedUri
    const dir = await fs.dir('logs')
    if (!dir) throw new Error('log-file: no logs directory available')
    cachedUri = fs.join(dir, fileName)
    return cachedUri
  }

  /**
   * Roll `app.log` to `app.log.1`, `.1` to `.2`, and drop the oldest.
   *
   * Deliberately dumb: numbered suffixes rather than timestamps, so the set of
   * files is bounded and predictable without reading the directory.
   */
  async function rotate(fs: FsService, uri: Uri): Promise<void> {
    for (let i = maxFiles - 1; i >= 1; i--) {
      const from = `${uri}.${i}`
      if (await fs.exists(from)) {
        if (i === maxFiles - 1) await fs.remove(from).catch(() => undefined)
        else await fs.move(from, `${uri}.${i + 1}`).catch(() => undefined)
      }
    }
    await fs.move(uri, `${uri}.1`).catch(() => undefined)
  }

  /** `fs` is passed in: live from `ctx` normally, captured during teardown. */
  async function flush(fs: FsService): Promise<void> {
    if (!queued.length) return
    const batch = queued
    queued = []

    try {
      const uri = await logUri(fs)
      if (await fs.exists(uri)) {
        const { size } = await fs.stat(uri)
        if (size > maxBytes) await rotate(fs, uri)
      }
      await fs.writeFile(uri, batch.join(''), { append: true })
    } catch (error) {
      // Never throw from a log transport: a failure to write logs must not
      // become an application error. Report it once, to the console.
      console.error('[log-file] write failed:', error)
    }
  }

  function schedule(): void {
    if (timer || disposed) return
    timer = setTimeout(() => {
      timer = undefined
      // Hot path: read the service through the context, every time.
      writing = writing.then(() => flush(ctx.fs))
    }, flushDelayMs)
  }

  return ctx.effect(function* () {
    yield ctx.logger.exporter({
      export(message) {
        if (message.level > maxLevel) return
        const { fullMessage, unused } = formatLogArguments(message.args as unknown[])
        const record: LogRecord = {
          sn: message.sn,
          time: message.ts,
          level: levelName(message.level),
          scope: message.name,
          message: fullMessage,
          ...(unused.length ? { meta: { args: unused } } : {}),
        }
        queued.push(`${JSON.stringify(record)}\n`)
        schedule()
      },
    })

    yield () => {
      disposed = true
      if (timer) clearTimeout(timer)
      // The one place the captured reference is used: by now this fiber is
      // UNLOADING and `ctx.fs` would throw. Losing the last second of logs is
      // exactly the second you wanted when diagnosing a crash on shutdown.
      writing = writing.then(() => flush(fsAtLoad))
    }
  }, 'log-file')
}

export default { name, inject, apply }
