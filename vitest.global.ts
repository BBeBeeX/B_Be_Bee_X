/**
 * One scratch root per run, removed when the run ends.
 *
 * The harnesses create temp directories and, being harnesses, do not get to
 * clean up after a test that threw. Collecting them under a single root and
 * removing that root here makes cleanup independent of whether the suite
 * passed — which is when it matters, because a failing run is the one that
 * leaves the most behind.
 *
 * `process.env` set here is inherited by the worker processes vitest forks
 * afterwards, which is how `tempDir()` in `@BBeBee/kernel/testing` finds it.
 * If that ever stops holding, the fallback is `tmpdir()` and the only symptom
 * is the leak coming back — not a broken run.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default async function setup(): Promise<() => Promise<void>> {
  const root = await mkdtemp(join(tmpdir(), 'bbebee-run-'))
  process.env.BBEBEE_TEST_TMP = root
  return async () => {
    await rm(root, { recursive: true, force: true })
  }
}
