# @b_be_bee/configs/tailwindcss
> Update this doc when Tailwind entrypoints, plugins, or generated utility conventions change.

## Purpose

This directory holds the Tailwind web preset and its supporting plugins/CSS extensions used across the workspace.

## File Inventory

- `web.ts` - main Tailwind configuration entrypoint exported by the package.
- `tw-css-plugin.js` - custom Tailwind CSS plugin glue.
- `ratio-mixing-plugin.js` - ratio/mixing helpers used by the design system.
- `tailwind-extend.css` - shared CSS extension layer consumed by the web preset.

## Key Exports

- `web.ts` via `@b_be_bee/configs/tailwindcss/web`

## Dependencies

- Depends on: `tailwindcss`, UIKit color tooling, icon plugins, custom CSS plugin helpers.
- Depended on by: desktop/web builds and any package that imports the shared Tailwind preset.
