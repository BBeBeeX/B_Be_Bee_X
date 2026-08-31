/**
 * The conformance harness.
 *
 * Suites are exported as **data**, not as calls into a test runner: each is a
 * list of named async checks. That keeps them runnable under Vitest in Node
 * (for `core-*-node`) and under Detox on a real device (for `core-*-expo`),
 * which is the whole point — an abstraction tested on only one platform drifts
 * within a month.
 *
 * See docs/04-core-services.md §18.
 */

export interface ConformanceCheck<T> {
  name: string
  /** Why this behaviour matters. Shown when the check fails. */
  because: string
  run(subject: T): Promise<void>
}

export interface ConformanceSuite<T> {
  service: string
  checks: ConformanceCheck<T>[]
}

/** Minimal assertion helpers, so suites need no assertion library. */
export class ConformanceFailure extends Error {
  override readonly name = 'ConformanceFailure'
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ConformanceFailure(message)
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    throw new ConformanceFailure(`${message ?? 'values differ'}: expected ${e}, got ${a}`)
  }
}

/**
 * Assert a rejection.
 *
 * `match` is not optional by accident: without it, "stat of a missing file
 * rejects" also passes when the real cause was a permission error or a typo in
 * the test, which makes the check worthless as a contract.
 */
export async function assertRejects(
  fn: () => Promise<unknown>,
  message: string,
  match: RegExp | ((error: unknown) => boolean),
): Promise<void> {
  let error: unknown
  let threw = false
  try {
    await fn()
  } catch (caught) {
    threw = true
    error = caught
  }
  if (!threw) throw new ConformanceFailure(`expected rejection: ${message}`)

  const ok =
    typeof match === 'function'
      ? match(error)
      : match.test(error instanceof Error ? error.message : String(error))
  if (!ok) {
    throw new ConformanceFailure(
      `rejected, but not as expected (${message}): ${String(
        error instanceof Error ? error.message : error,
      )}`,
    )
  }
}

/**
 * Run a suite outside a test runner — useful for a smoke check on device.
 * Under Vitest, prefer iterating `suite.checks` so each becomes its own `it()`.
 */
export async function runSuite<T>(
  suite: ConformanceSuite<T>,
  subject: T,
): Promise<{ passed: string[]; failed: { name: string; error: unknown }[] }> {
  const passed: string[] = []
  const failed: { name: string; error: unknown }[] = []
  for (const check of suite.checks) {
    try {
      await check.run(subject)
      passed.push(check.name)
    } catch (error) {
      failed.push({ name: check.name, error })
    }
  }
  return { passed, failed }
}
