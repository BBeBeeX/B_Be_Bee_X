# @b_be_bee/configs
> Update this doc when exported config entrypoints or build-tool dependencies change.

## Purpose

`packages/configs/` centralizes configuration consumed by workspace packages, with the current public surface focused on Tailwind web setup and a shared TypeScript base extension.

## File Inventory

- `package.json` - package metadata and export map.
- `tsconfig.extend.json` - shared TypeScript base configuration.
- `tailwindcss/` - Tailwind presets, plugins, and CSS helpers exported to workspace apps/packages.
- `node_modules/` - local install artifacts; not documented further.

## Key Exports

- `@b_be_bee/configs/tailwindcss/web`
- `@b_be_bee/configs/tsconfig.extend.json`

## Dependencies

- Depends on: Tailwind ecosystem plugins, Iconify packages, PostCSS utilities.
- Depended on by: most workspace packages through `devDependencies`, especially desktop/web-facing packages.
