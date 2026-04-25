# @b_be_bee/logger
> Update this doc when logging targets or export conditions change.

## Purpose

`packages/internal/logger/` provides the shared logging contract for workspace packages. Callers import one logger API, and the package selects the Electron-backed or console-backed implementation internally at runtime.

## File Inventory

- `index.ts` - public logger interface and environment-aware runtime selection.
- `electron.ts` - Electron logger backend adapter.
- `web.ts` - console-backed fallback logger backend.
- `package.json` - package export map.
- `tsconfig.json` - package TypeScript configuration.

## Key Exports

- `logger` shared singleton
- `initialize`, `log`, `info`, `warn`, `error`, `debug`

## Dependencies

- Depends on: `electron-log` and shared config from `@b_be_bee/configs`.
- Depended on by: shared packages and app runtimes that should log through one workspace logger entrypoint.
