/**
 * Console log transport. Development only.
 *
 * Registers a Cordis *exporter* — the mechanism `ctx.logger` already provides —
 * rather than inventing a logging service. See docs/04-core-services.md §16.
 */

import type { Context } from 'cordis'
import { formatLogArguments, levelName } from '@BBeBee/protocol'

export interface ConsoleLogConfig {
  /** 0=error, 1=warn, 2=info, 3=debug. */
  level?: number
  /** Off by default: log lines are for developers, secrets are for nobody. */
  raw?: boolean
  /** When false, console logging is disabled. Defaults to true. */
  debug?: boolean
}

export const name = 'plugin-log-console'

export async function apply(ctx: Context, config: ConsoleLogConfig = {}) {
  if (config.debug === false) return
  const maxLevel = config.level ?? 2

  return ctx.logger.exporter({
    export(message) {
      if (message.level > maxLevel) return

      const level = levelName(message.level)
      const time = new Date(message.ts).toISOString().slice(11, 23)
      const { text, unused } = formatLogArguments(message.args as unknown[], { raw: config.raw })
      const line = `${time} ${level.toUpperCase().padEnd(5)} [${message.name}] ${text}`

      const extra = unused.map((a) => {
        if (a && typeof a === 'object') {
          if ('message' in a && typeof (a as { message: unknown }).message === 'string') {
            const e = a as { name?: string; message: string; stack?: string }
            return e.stack || `${e.name ?? 'Error'}: ${e.message}`
          }
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        }
        return a
      })

      const method =
        level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      if (extra.length > 0) {
        method(line, ...extra)
      } else {
        method(line)
      }
    },
  })
}

export default { name, apply }
