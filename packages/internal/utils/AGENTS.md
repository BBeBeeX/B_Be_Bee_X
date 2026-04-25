# @b_be_bee/utils
> Update this doc when utility entrypoints, package layout, or platform helper boundaries change.

## Purpose

`packages/internal/utils/` contains low-level shared helpers used across packages, including namespace helpers, general utilities, native-specific utilities, and small data-structure helpers.

## File Inventory

- `utils.ts` - general utility helpers.
- `ns.ts` - namespace-related helpers.
- `native/` - native/platform checks and exports.
- `data-structure/` - small reusable data-structure helpers.
- `package.json` - package metadata and intended export surface.

## Key Exports

- Current source files are rooted in `utils.ts`, `ns.ts`, `native/`, and `data-structure/`
- `package.json` declares root and wildcard exports; keep this doc aligned if the package layout is normalized

## Dependencies

- Depends on: shared utility libraries such as `dayjs`, `dompurify`, `motion`, `tldts`, and React Native peer support.
- Depended on by: `@b_be_bee/store` and other workspace packages that need cross-platform helper functions.
