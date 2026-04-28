# packages/plugin
> Update this doc when plugin workspace package boundaries move or dependencies change.

## Purpose

`packages/plugin/` groups the plugin-related workspace packages. It is not itself a package.

## Package Boundaries

- `plugin-sdk/` owns plugin-author-facing contracts and type exports. It must not depend on `@b_be_bee/database`.
- `plugin-loader/` owns package parsing, manifest validation, integrity/signature checks, permission checks, and static source scans. It must not depend on `@b_be_bee/database`.
- `plugin-host/` owns host API construction for auth, network, and logging. It must not depend on `@b_be_bee/database`.
- `plugin-runtime/` owns runtime orchestration, sandbox execution, lifecycle transitions, and registry integration. Database access belongs here.

## Dependency Direction

`plugin-sdk` <- `plugin-loader` <- `plugin-host` <- `plugin-runtime`

`plugin-runtime` may also depend directly on `plugin-sdk`. Do not add a standalone plugin registry package.

## Validation

- Run `pnpm --filter @b_be_bee/plugin-sdk typecheck` after SDK contract changes.
- Run `pnpm --filter @b_be_bee/plugin-loader typecheck` after loader, manifest, signature, or scan changes.
- Run `pnpm --filter @b_be_bee/plugin-host typecheck` after host API changes.
- Run `pnpm --filter @b_be_bee/plugin-runtime typecheck` after runtime, sandbox, lifecycle, or registry changes.
