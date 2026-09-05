// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * The rules that matter here are the architectural ones. Style is secondary;
 * these three exist because code review will not catch them reliably and each
 * protects a specific claim in docs/.
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
      'no-restricted-imports': ['error', { patterns: PLATFORM_SDKS }],
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
        { patterns: [...PLATFORM_SDKS, 'cordis', '@BBeBee/kernel'] },
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
        { patterns: PLATFORM_SDKS.filter((p) => !p.startsWith('react-native')) },
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
      'no-restricted-imports': ['error', { patterns: PLATFORM_SDKS }],
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
