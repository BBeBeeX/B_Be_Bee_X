/**
 * Console log transport. Development only.
 *
 * Registers a Cordis *exporter* — the mechanism `ctx.logger` already provides —
 * rather than inventing a logging service. See docs/04-core-services.md §16.
 */

import type { Context } from 'cordis'
import { levelName, redact, redactString } from '@BBeBee/protocol'

export interface ConsoleLogConfig {
  /** 0=error, 1=warn, 2=info, 3=debug. */
  level?: number
  /** Off by default: log lines are for developers, secrets are for nobody. */
  raw?: boolean
}

export const name = 'plugin-log-console'

export function apply(ctx: Context, config: ConsoleLogConfig = {}) {
  const maxLevel = config.level ?? 2

  return ctx.logger.exporter({
    export(message) {
      if (message.level > maxLevel) return

      const level = levelName(message.level)
      const time = new Date(message.ts).toISOString().slice(11, 23)
      const [first, ...rest] = message.args as unknown[]

      const text = typeof first === 'string' ? first : String(first)
      const line = `${time} ${level.toUpperCase().padEnd(5)} [${message.name}] ${
        config.raw ? text : redactString(text)
      }`

      const extra = config.raw ? rest : rest.map((a) => redact(a))
      const method =
        level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      method(line, ...extra)
    },
  })
}

export default { name, apply }
