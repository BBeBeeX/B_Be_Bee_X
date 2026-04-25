# @b_be_bee/store
> Update this doc when module names, exported state APIs, or hydration/reset contracts change.

## Purpose

`packages/internal/store/` owns shared client-side state modules built on Zustand and TanStack Query, along with hydration and reset helpers that keep in-memory state aligned with `@b_be_bee/database` persistence and the canonical contracts in `@b_be_bee/models`.

## File Inventory

- `src/modules/` - shared model-backed stores for songs/tracks, playlists/collections, favorites, lyrics, play statistics, plugin credentials, and images.
- `src/lib/` - shared store infrastructure helpers.
- `src/@types/` - local type augmentations.
- `src/hydrate.ts` - store hydration entrypoint.
- `src/reset.ts` - global reset helpers.

## Key Exports

- `./hydrate`
- `./reset`
- Module-scoped exports for `./song/*`, `./playlist/*`, `./favorite/*`, `./lyric/*`, `./playStatistics/*`, `./pluginCredential/*`, and `./image/*`

## Store Contracts

- Package documentation, export maps, and `src/modules/` must describe the same shared module set.
- Shared store terminology should follow `@b_be_bee/models` contracts even when file names use legacy aliases such as `song`.
- Each documented shared module should remain part of the common hydrate/reset lifecycle unless it is explicitly documented as opt-in.
- Shared store modules should consume typed database services instead of duplicating persistence logic locally.

## Hydration And Reset

- `hydrateDatabaseToStore` initializes the database when requested and hydrates all registered shared modules from their matching database services.
- `resetStore` must reset the same documented shared modules so memory and persistence stay in sync during tests and runtime resets.
- When adding a new shared store module, update `src/hydrate.ts`, `src/reset.ts`, and `package.json` exports in the same change.

## Dependencies

- Depends on: `@b_be_bee/database`, `@b_be_bee/logger`, `@b_be_bee/models`, `@b_be_bee/tracker`, `@b_be_bee/utils`, Zustand, and TanStack Query.
- Depended on by: desktop/mobile app state layers and any shared UI that consumes store modules.
