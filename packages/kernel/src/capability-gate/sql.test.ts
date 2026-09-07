/**
 * Reading SQL as text.
 *
 * Each of these pins a hole that was real: a literal read as syntax, a second
 * statement executed silently, and a forbidden statement that only one of two
 * lists knew about.
 */

import { describe, expect, it } from 'vitest'
import { CapabilityError } from '@BBeBee/protocol'
import { assertSingleStatement, assertSqlAllowed, isMultiStatement, sanitizeSql } from './sql.js'

describe('sanitizeSql', () => {
  it('blanks literals without touching the syntax around them', () => {
    expect(sanitizeSql("UPDATE tracks SET title = 'a--b'")).toBe("UPDATE tracks SET title = ''")
    expect(sanitizeSql("INSERT INTO t VALUES ('a; DROP TABLE tracks')")).toBe(
      "INSERT INTO t VALUES ('')",
    )
    // The doubled-quote escape ends nothing.
    expect(sanitizeSql("SELECT 'it''s' FROM t")).toBe("SELECT '' FROM t")
  })

  it('removes comments', () => {
    expect(sanitizeSql('SELECT 1 -- DROP TABLE tracks').trim()).toBe('SELECT 1')
    expect(sanitizeSql('SELECT /* DROP TABLE tracks */ 1').replace(/\s+/g, ' ')).toBe('SELECT 1')
  })

  it('leaves a literal that contains a comment marker alone', () => {
    // The old stripper cut here, losing the rest of the statement and with it
    // any table the gate needed to see.
    expect(sanitizeSql("UPDATE t SET a = 'x--y' WHERE b = 1")).toContain('WHERE b = 1')
  })
})

describe('isMultiStatement', () => {
  it('counts statements, not semicolons', () => {
    expect(isMultiStatement('SELECT 1')).toBe(false)
    expect(isMultiStatement('SELECT 1;')).toBe(false)
    expect(isMultiStatement('  SELECT 1 ;  ')).toBe(false)
    expect(isMultiStatement('SELECT 1; SELECT 2')).toBe(true)
    expect(isMultiStatement('CREATE TABLE a (x TEXT); CREATE TABLE b (x TEXT)')).toBe(true)
  })

  it('does not mistake a semicolon inside a literal for a boundary', () => {
    // Otherwise an ordinary title with a semicolon in it becomes unwritable.
    expect(isMultiStatement("INSERT INTO t VALUES ('a; b')")).toBe(false)
  })

  it('explains the driver behaviour when it throws', () => {
    expect(() => assertSingleStatement('SELECT 1; SELECT 2')).toThrow(/multi-statement/)
    expect(() => assertSingleStatement('SELECT 1')).not.toThrow()
  })
})

describe('assertSqlAllowed', () => {
  it('refuses the arbitrary-file primitives for any caller', () => {
    expect(() => assertSqlAllowed("ATTACH DATABASE '/tmp/x.db' AS x")).toThrow(CapabilityError)
    expect(() => assertSqlAllowed('DETACH DATABASE x')).toThrow(CapabilityError)
    // The one that was in the kernel's list and missing from the bridge's.
    expect(() => assertSqlAllowed("VACUUM INTO '/tmp/x.db'")).toThrow(/may not issue VACUUM INTO/)
  })

  it('checks every statement, not just the first', () => {
    expect(() => assertSqlAllowed("SELECT 1; ATTACH DATABASE '/tmp/x.db' AS x")).toThrow(
      /may not issue ATTACH/,
    )
  })

  it('allows a plain VACUUM and a literal that merely mentions ATTACH', () => {
    expect(() => assertSqlAllowed('VACUUM')).not.toThrow()
    expect(() => assertSqlAllowed("INSERT INTO t VALUES ('ATTACH')")).not.toThrow()
  })

  it('names the caller it refused', () => {
    expect(() => assertSqlAllowed('ATTACH DATABASE x AS y', 'the bridge')).toThrow(/the bridge/)
  })
})
