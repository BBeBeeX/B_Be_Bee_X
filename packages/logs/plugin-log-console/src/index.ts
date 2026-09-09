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
  /** When false, console logging is disabled. Defaults to true. */
  debug?: boolean
}

export const name = 'plugin-log-console'

/**
 * ⚠️ `async` is load-bearing, not decoration.
 *
 * Cordis decides "is this a class?" with `!!func.prototype`. A plain
 * `function apply(…)` has one, so it is `new`-ed as if it were a service and
 * the disposer it returns is discarded — the plugin loads, works, and never
 * unloads. An async function has no prototype. `conventions.test.ts` fails the
 * build on the other shape (docs/03 §2).
 */
function formatTemplate(template: string, args: unknown[]): { text: string; unused: unknown[] } {
  let index = 0
  const text = template.replace(/%[sdjifoO%]/g, (match) => {
    if (match === '%%') return '%'
    if (index >= args.length) return match
    const val = args[index++]
    if (match === '%j') {
      try {
        return JSON.stringify(val)
      } catch {
        return String(val)
      }
    }
    if (match === '%d' || match === '%i') return String(Number(val))
    if (match === '%f') return String(parseFloat(String(val)))
    if (typeof val === 'object' && val !== null) {
      if ('stack' in val && typeof (val as { stack: unknown }).stack === 'string') {
        return (val as { stack: string }).stack
      }
      if ('message' in val && typeof (val as { message: unknown }).message === 'string') {
        const e = val as { name?: string; message: string }
        return `${e.name ?? 'Error'}: ${e.message}`
      }
      try {
        return JSON.stringify(val)
      } catch {
        return String(val)
      }
    }
    return String(val)
  })
  return { text, unused: args.slice(index) }
}

export async function apply(ctx: Context, config: ConsoleLogConfig = {}) {
  if (config.debug === false) return
  const maxLevel = config.level ?? 2

  return ctx.logger.exporter({
    export(message) {
      if (message.level > maxLevel) return

      const level = levelName(message.level)
      const time = new Date(message.ts).toISOString().slice(11, 23)
      const [first, ...rest] = message.args as unknown[]

      const rawFirst = typeof first === 'string' ? first : String(first)
      const sanitizedFirst = config.raw ? rawFirst : redactString(rawFirst)
      const sanitizedRest = config.raw ? rest : rest.map((a) => redact(a))

      const { text: formatted, unused } = formatTemplate(sanitizedFirst, sanitizedRest)
      const line = `${time} ${level.toUpperCase().padEnd(5)} [${message.name}] ${formatted}`

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
