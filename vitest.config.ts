import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      /*
       * The mobile packages import their native module at module scope, which
       * Metro resolves and Node cannot. Aliasing it to a stub is what lets the
       * *logic* in those packages — the command mapping, the control
       * enabling, the artwork policy — be tested at all; the stub throws on
       * anything genuinely native, so a test that strays there fails rather
       * than passing against a fake.
       */
      'react-native-audio-api': fileURLToPath(
        new URL('./test/stubs/react-native-audio-api.ts', import.meta.url),
      ),
    },
  },
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
