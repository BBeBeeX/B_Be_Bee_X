/**
 * Reading SQL as text.
 *
 * Everything here is a regex over the shapes SQLite actually uses, not a
 * parser, and everything fails *closed*. It exists because two different
 * consumers — the capability gate and the `ctx.db` implementations — must
 * agree about what a statement is, and when they disagreed the gaps were real:
 * a second list of forbidden SQL in the desktop bridge that had drifted, and a
 * driver that silently executes only the first statement of a string.
 *
 * Its own module rather than part of `capability.ts` so the migration runner
 * can use it without an import cycle.
 */

import { CapabilityError } from '@BBeBee/protocol'

/**
 * Blank out string literals and comments so everything downstream reads
 * executable SQL only.
 *
 * Both halves are load-bearing. A literal is not syntax: `SET title = 'a--b'`
 * must not lose its tail to comment stripping, and `VALUES ('a; DROP TABLE
 * tracks')` is one statement, not two. A comment is not syntax either, so
 * `-- SELECT 1` must not make a `DROP` look like a read. Quotes and comment
 * bodies are replaced rather than deleted, which keeps word boundaries intact.
 */
export function sanitizeSql(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]!

    // A string literal, with SQLite's doubled-quote escape.
    if (ch === "'" || ch === '"') {
      i++
      while (i < sql.length) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      out += `${ch}${ch}`
      continue
    }

    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
      continue
    }

    if (ch === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }

    out += ch
    i++
  }
  return out
}

/** The statements in a string, comments and literals already discounted. */
export function statementsOf(sql: string): string[] {
  return sanitizeSql(sql)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Whether a string holds more than one statement.
 *
 * Worth asking because the drivers do not: `node:sqlite`'s `prepare()`
 * compiles the *first* statement and silently discards the rest, so
 * `CREATE TABLE a; CREATE TABLE b` creates `a`, reports success, and leaves no
 * trace that `b` never happened.
 */
export function isMultiStatement(sql: string): boolean {
  return statementsOf(sql).length > 1
}

/** Throwing form of {@link isMultiStatement}, called by `ctx.db` implementations. */
export function assertSingleStatement(sql: string): void {
  if (!isMultiStatement(sql)) return
  throw new Error(
    'db: multi-statement SQL is not supported — the driver compiles only the first statement ' +
      'and silently discards the rest. Pass statements separately.',
  )
}

/**
 * SQL refused for **every** caller, gated or not.
 *
 * `ATTACH`/`DETACH` turn a database handle into an arbitrary-file read/write
 * primitive, and `VACUUM INTO` writes a database file to any path the process
 * can reach — the same capability by another name. This lives in the kernel
 * and is called from both the gated path (`assertDb`) and the ungated desktop
 * bridge, because two lists of forbidden SQL drift apart: the bridge's listed
 * `ATTACH`/`DETACH` only, so `VACUUM INTO '/tmp/x.db'` went straight through
 * the containment checks it exists to enforce.
 *
 * Not anchored to the start of the string: every statement is checked.
 */
const FORBIDDEN_STATEMENT = /\b(ATTACH|DETACH|VACUUM\s+INTO)\b/i

export function assertSqlAllowed(sql: string, who = 'this caller'): void {
  for (const statement of statementsOf(sql)) {
    const match = FORBIDDEN_STATEMENT.exec(statement)
    if (match) {
      throw new CapabilityError(
        'db',
        `${who} may not issue ${match[1]!.toUpperCase().replace(/\s+/g, ' ')}`,
      )
    }
  }
}
