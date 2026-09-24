#!/usr/bin/env node
/** `pnpm check:changed` — check only packages and files in the current diff */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCheckChanged } from './index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function flagValue(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1]
  }
  return undefined
}

if (flag('help') || flag('h')) {
  console.log(`usage: pnpm check:changed [options] [since]

Checks only packages and files affected by the current diff (typecheck + lint + test).

Options:
  --since <ref>       Git ref/commit to compare against (default: auto-detected base/HEAD)
  --fix               Pass --fix to ESLint for automatic fixes
  --all               Run full workspace checks if root configs change (default: scope to affected packages)
  --timeout <ms>      Test timeout in milliseconds (default: 30000)
  --related           Use Vitest full dependency graph tracing instead of package-scoped tests
  --typecheck-only    Only run typecheck on affected packages
  --lint-only         Only run ESLint on changed files
  --test-only         Only run Vitest on affected tests
  --help, -h          Show this help message

Examples:
  pnpm check:changed
  pnpm check:changed origin/main
  pnpm check:changed --since HEAD~1
  pnpm check:changed --fix
  pnpm check:changed --timeout 60000
  pnpm check:changed --lint-only
`)
  process.exit(0)
}

// Check if a positional argument was passed as [since]
const positional = process.argv
  .slice(2)
  .find((arg) => !arg.startsWith('-'))

const since = flagValue('since') ?? positional
const timeoutStr = flagValue('timeout')
const timeout = timeoutStr ? parseInt(timeoutStr, 10) : 30_000

const exitCode = runCheckChanged({
  root,
  since,
  fix: flag('fix'),
  all: flag('all'),
  timeout,
  related: flag('related'),
  typecheckOnly: flag('typecheck-only'),
  lintOnly: flag('lint-only'),
  testOnly: flag('test-only'),
})

process.exit(exitCode)
