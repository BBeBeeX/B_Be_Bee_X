// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * The rules that matter here are the architectural ones. Style is secondary;
 * these exist because code review will not catch them reliably and each
 * protects a specific claim in docs/.
 *
 * They are the layer model of docs/02-architecture.md §1 made mechanical:
 *
 *   Layer 4  apps/* · plugin-*-ui-* · ui-*      pages, interactions, orchestration
 *   Layer 3  plugin-* (headless) · source-rules business features
 *   Layer 2  core-*                             the only layer allowed to call a
 *                                               platform SDK or drive the kernel
 *   Layer 1  kernel                             DI, fibers, config, loader, gate
 *   Layer 0  protocol                           contracts, zero runtime
 *
 * A layer names anything below it, but Layers 3 and 4 name Layer 2 through
 * *service keys* declared at Layer 0 — never by import. That is what the
 * `@BBeBee/core-*` bans below are for; the docs/09 §3 matrix is this file,
 * read as a table.
 */

/** Platform SDKs. See docs/02-architecture.md §1 — "the invariant". */
const PLATFORM_SDKS = [
  'expo',
  'expo-*',
  'expo/*',
  'react-native',
  'react-native/*',
  'react-native-*',
  'electron',
  'electron/*',
  'node:*',
  'fs',
  'fs/promises',
  'path',
  'os',
  'crypto',
  'child_process',
  'better-sqlite3',
  'music-metadata',
  'ws',
]

/**
 * The kernel's *plugin* surface: the exports that merely **type** a plugin, as
 * opposed to the bootstrap surface that **drives** the kernel. docs/02 §1 —
 * the invariant, rule 2.
 *
 * `@BBeBee/kernel` has two kinds of export. This list is the first kind — the
 * pinned Cordis re-exports of docs/09 §5.1, which every layer may import
 * because plugins are asked to take Cordis from the kernel rather than from
 * `cordis` directly. Everything else the kernel exports is the second kind:
 * `createApp`, the config loader, the plugin loader, the capability gate, the
 * SQL guards, the migration runner. A feature plugin is *handed* a context; it
 * does not build one, resolve plugins, read the config store, or consult the
 * gate.
 *
 * Expressed as an allow-list rather than a ban-list on purpose. The bootstrap
 * surface is long and grows; this one is short and is pinned to the shape of
 * upstream Cordis. A new kernel export is therefore closed to Layers 3 and 4
 * by default, which is the safe direction to fail in — and
 * `kernel/src/layers.test.ts` keeps this list identical to the re-export block
 * at the top of `kernel/src/index.ts`.
 */
const KERNEL_PLUGIN_SURFACE = [
  // values
  'Context',
  'Service',
  'Inject',
  'FiberState',
  'fiberStateName',
  'isActive',
  'isSettled',
  // types
  'Plugin',
  'Fiber',
  'Effect',
  'EffectMeta',
  'InjectSpec',
  'FiberStateName',
  'FiberStateValue',
]

/** Shorthand: the same `paths` entry is needed in several blocks below. */
const KERNEL_GUARD = {
  name: '@BBeBee/kernel',
  allowImportNames: KERNEL_PLUGIN_SURFACE,
  message:
    'Layers 3 and 4 may import the pinned Cordis surface (Context, Service, Inject, ' +
    'FiberState, …) but not the bootstrap surface — a plugin is handed a context, it ' +
    'does not build one. See docs/02 §1 — the invariant.',
}

/**
 * Layer 2 packages, named as import patterns. Both forms are listed because a
 * gitignore-style `*` does not cross a `/`, so the bare name alone would let
 * `@BBeBee/core-desktop-bridge/main` through.
 */
const CORE_PACKAGES = ['@BBeBee/core-*', '@BBeBee/core-*/**']

/**
 * The composition root: the only files allowed to call `createApp` and to name
 * a Layer 2 package by import. docs/02 §1 — "three deliberate exceptions".
 *
 * This is wiring, not business function. Everything else under `apps` is plain
 * Layer 4 and is linted as such. The generated `plugins.ts` beside each is the
 * codegen half of the same job, and is in the global `ignores` above.
 */
const COMPOSITION_ROOT = [
  'apps/mobile/src/boot.ts',
  'apps/mobile/src/plugins.ts',
  'apps/desktop/renderer/boot.ts',
  'apps/desktop/renderer/plugins.ts',
]

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/out/**',
      // Emitted by `pnpm gen:plugins`; checked by regenerating, not linting.
      '**/generated/**',
      // Build-tool config in plain JS, outside every tsconfig program.
      'apps/*/metro.config.js',
      'apps/*/babel.config.js',
      'apps/mobile/index.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        // Config files — and the test stubs the vitest config aliases to —
        // belong to no package tsconfig program.
        projectService: {
          allowDefaultProject: ['*.ts', '*.js', 'apps/*/*.config.ts', 'test/stubs/*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  {
    // docs/02 §1 — THE invariant. Only packages/core-* may touch a platform
    // SDK; everything else reaches the platform through a ctx.* service.
    // Widening this list is almost always the wrong fix: add a core service.
    // `.tsx` as well as `.ts`: every view package is `.tsx`, so a glob that
    // stopped at `.ts` exempted from THE invariant exactly the packages most
    // likely to reach for a platform SDK.
    files: [
      'packages/plugin-*/**/*.ts',
      'packages/plugin-*/**/*.tsx',
      'packages/ui-*/**/*.ts',
      'packages/ui-*/**/*.tsx',
      'packages/protocol/**/*.ts',
    ],
    ignores: ['packages/plugin-*-ui-*/**/*.ts', 'packages/plugin-*-ui-*/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        // `paths` and `patterns` are one option object per file set: ESLint
        // *replaces* a rule's options rather than merging them, so every block
        // that covers a file has to restate the whole ban. Splitting these
        // across two blocks would silently disable the first.
        { paths: [KERNEL_GUARD], patterns: [...PLATFORM_SDKS, ...CORE_PACKAGES] },
      ],
    },
  },

  {
    // docs/06 §3, docs/09 §3 — the rule engine is pure logic: no platform, and
    // no I/O either. It takes a document and a rule and returns a value; every
    // fetch belongs to plugin-source-runtime. Keeping it pure is what makes a
    // corpus of real source documents runnable against recorded fixtures with
    // no network — and what keeps rule evaluation testable without a kernel.
    files: ['packages/source-rules/**/*.ts'],
    ignores: ['packages/source-rules/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...PLATFORM_SDKS, ...CORE_PACKAGES, 'cordis', '@BBeBee/kernel'] },
      ],
    },
  },

  {
    // docs/08 §1 — UI packages may render, but may not reach the platform.
    // `react-native` is allowed here (ADR-2 accepts a per-target view layer);
    // its capability modules are not.
    files: [
      'packages/plugin-*-ui-mobile/**/*.ts',
      'packages/plugin-*-ui-mobile/**/*.tsx',
      'packages/ui-kit-mobile/**/*.ts',
      'packages/ui-kit-mobile/**/*.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [KERNEL_GUARD],
          patterns: [
            ...PLATFORM_SDKS.filter((p) => !p.startsWith('react-native')),
            ...CORE_PACKAGES,
          ],
        },
      ],
    },
  },

  {
    // The desktop half of the same rule, which was missing entirely: the block
    // above exempts every `plugin-*-ui-*` package from the invariant and only
    // puts `-ui-mobile` back under one, so a desktop view package could
    // `import { ipcRenderer } from 'electron'` and nothing would say a word.
    // Its render target is `react-dom`, which is not a platform SDK, so this
    // one bans the whole list.
    files: [
      'packages/plugin-*-ui-desktop/**/*.ts',
      'packages/plugin-*-ui-desktop/**/*.tsx',
      'packages/ui-kit-desktop/**/*.ts',
      'packages/ui-kit-desktop/**/*.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [KERNEL_GUARD], patterns: [...PLATFORM_SDKS, ...CORE_PACKAGES] },
      ],
    },
  },

  {
    // docs/02 §1 — Layer 1 depends on Layer 0 and nothing else. A kernel that
    // knows which plugins exist is not a kernel: it resolves them from a
    // registry the shell hands it, which is what lets the same kernel boot two
    // different plugin graphs on two platforms.
    //
    // `src/testing.ts` is exempt for the same reason `*.test.ts` is: it is the
    // `@BBeBee/kernel/testing` entry point, used only by test files, and
    // `snapshotContext` legitimately needs `node:fs` for a scratch directory.
    files: ['packages/kernel/src/**/*.ts'],
    ignores: ['packages/kernel/src/**/*.test.ts', 'packages/kernel/src/testing.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...PLATFORM_SDKS,
            ...CORE_PACKAGES,
            '@BBeBee/plugin-*',
            '@BBeBee/plugin-*/**',
            '@BBeBee/ui-*',
            '@BBeBee/ui-*/**',
          ],
        },
      ],
    },
  },

  {
    // @BBeBee/protocol must stay dependency-free so it is safe to import in
    // any runtime — headless plugin, core service, kernel, or either shell.
    // `cordis` is the sole exception, and only as a type-only import.
    files: ['packages/protocol/src/**/*.ts'],
    ignores: ['packages/protocol/src/conformance/**/*.ts', 'packages/protocol/src/**/*.test.ts'],
    rules: {
      // `^[^.]` matches bare specifiers only, leaving relative imports alone.
      // `allowTypeImports` is what lets `import type {} from 'cordis'` through,
      // which is exactly the one external reference protocol is allowed.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^[^.]',
              allowTypeImports: true,
              message:
                'protocol must stay runtime-free: only type-only imports of external packages are allowed',
            },
          ],
        },
      ],
    },
  },

  {
    // docs/02 §1 — the shells are Layer 4. They reach Layer 2 through service
    // keys like every other Layer 4 package; the composition root beside them
    // is the one exception, and it is listed once, above.
    //
    // Platform SDKs are deliberately NOT banned here: a shell owns genuinely
    // platform-bound chrome — safe-area insets, window controls, deep links
    // (docs/08 §7). What it may not do is skip past Layer 2 for a capability.
    files: [
      'apps/mobile/src/**/*.ts',
      'apps/mobile/src/**/*.tsx',
      'apps/desktop/renderer/**/*.ts',
      'apps/desktop/renderer/**/*.tsx',
    ],
    ignores: [...COMPOSITION_ROOT, '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [KERNEL_GUARD], patterns: CORE_PACKAGES },
      ],
    },
  },

  {
    // docs/02 §2 — `main` is an IPC host. Business logic there would break the
    // platform symmetry that ADR-3 exists to preserve.
    files: ['apps/desktop/main/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@BBeBee/plugin-*'] }],
    },
  },

  {
    // Tests are not shipped, so the platform-SDK ban does not apply to them:
    // a conformance harness legitimately needs `node:fs` to build a scratch
    // directory. Source files in the same packages are still covered above.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
)
