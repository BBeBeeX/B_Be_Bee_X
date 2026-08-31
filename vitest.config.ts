import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    // Cordis schedules work across microtask boundaries; a plugin that never
    // settles should fail loudly rather than hang CI.
    testTimeout: 10_000,
  },
})
