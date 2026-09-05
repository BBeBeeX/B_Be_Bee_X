import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.tsx` too: the kits' tests render components, and a pattern that
    // silently matched nothing would report "no test files" as success.
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    environment: 'node',
    // jsdom only where a hook needs one. Everything else stays in Node: a DOM
    // for the whole suite would slow every test that has no use for one, and
    // would let a Node-only package accidentally depend on `window`.
    environmentMatchGlobs: [['packages/*/src/**/*.test.tsx', 'jsdom']],
    // Creates the scratch root the harnesses allocate under, and removes it
    // when the run ends. See vitest.global.ts.
    globalSetup: ['./vitest.global.ts'],
    // Cordis schedules work across microtask boundaries; a plugin that never
    // settles should fail loudly rather than hang CI.
    testTimeout: 10_000,
  },
})
