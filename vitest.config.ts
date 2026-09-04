import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.tsx` too: the kits' tests render components, and a pattern that
    // silently matched nothing would report "no test files" as success.
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    environment: 'node',
    // Cordis schedules work across microtask boundaries; a plugin that never
    // settles should fail loudly rather than hang CI.
    testTimeout: 10_000,
  },
})
