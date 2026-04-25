# packages
> Update this doc when package directories are added, removed, or repurposed.

## Purpose

`packages/` contains reusable workspace packages and package-scoped tooling consumed by the desktop app, mobile app, and other shared modules.

## File Inventory

- `configs/` - shared build config exports, especially Tailwind and TypeScript presets.
- `internal/` - cross-platform runtime packages such as database, store, network, and utilities.
- `plugin/` - plugin manifest, host, runtime, sandbox, and validation helpers.

## Key Exports

- Workspace package names under the `@b_be_bee/*` scope.
- Shared config entrypoints from `@b_be_bee/configs`.
- Shared runtime libraries from `packages/internal/*`.

## Dependencies

- Depends on: workspace root `pnpm-workspace.yaml`, Turbo pipelines, shared TypeScript conventions.
- Depended on by: `apps/desktop`, `apps/mobile`, and any future shared services built in this monorepo.
