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
        // Config files belong to no package tsconfig program.
        projectService: {
          allowDefaultProject: ['*.ts', '*.js', 'apps/*/*.config.ts'],
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
    files: ['packages/plugin-*/**/*.ts', 'packages/ui-*/**/*.ts', 'packages/protocol/**/*.ts'],
    ignores: ['packages/plugin-*-ui-*/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: PLATFORM_SDKS }],
    },
  },

  {
    // docs/08 §1 — UI packages may render, but may not reach the platform.
    // `react-native` is allowed here (ADR-2 accepts a per-target view layer);
    // its capability modules are not.
    files: ['packages/plugin-*-ui-mobile/**/*.ts', 'packages/ui-kit-mobile/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: PLATFORM_SDKS.filter((p) => !p.startsWith('react-native')) },
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
    files: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
)
