# @b_be_bee/database
> Update this doc when schemas, services, migrations, or platform database entrypoints change.

## Purpose

`packages/internal/database/` owns the shared local persistence layer, including platform-specific database entrypoints, Drizzle schemas, typed service modules, generated migrations, and the supporting utilities that keep model-backed data consistent across desktop, web, and native runtimes.

## File Inventory

- `src/db.ts`, `src/db.desktop.ts`, `src/db.rn.ts` - database connection entrypoints by platform/runtime.
- `src/schemas/` - Drizzle schema definitions and persistence-facing types exposed to other packages.
- `src/services/` - typed domain services for tracks/songs, playlists/collections, lyrics, favorites, images, playback queue, playback source cache, play statistics, plugin accounts/sessions/credentials/registry, import jobs, local files, settings, and proxy settings.
- `src/drizzle/` - generated SQL migrations and metadata.
- `src/migrator.ts` - migration runner used by app bootstrap and tests.
- `src/constant.ts`, `src/types.ts`, `src/ResourceLock.ts`, `src/DatabaseSource.js` - shared database utilities, constants, and runtime support helpers.
- `drizzle.config.ts` - migration generation config.

## Key Exports

- Pattern exports for `./*`, `./schemas/*`, and `./services/*`.
- Root entrypoints include database bootstrap/runtime modules such as `db`, `db.desktop`, `db.rn`, `migrator`, shared constants, and support types.
- Service exports are the stable consumer surface for typed persistence operations; add new service modules there instead of reaching into internal folders.

## Dependencies

- Depends on: `@b_be_bee/logger`, `@b_be_bee/models`, `drizzle-orm`, `drizzle-kit`, and SQLite adapters for desktop/web/native runtimes.
- Depended on by: `@b_be_bee/network`, `@b_be_bee/store`, and `@b_be_bee/plugin`.

## Service Boundaries

- Keep public service contracts aligned with `@b_be_bee/models` terminology and persisted field shapes.
- `src/services/internal/` is implementation detail only; consumers should import from `@b_be_bee/database/services/*`.
- Track, collection, lyric, statistics, and plugin-related services are the package's shared music-library persistence surface.
- Encryption concerns stay isolated to plugin credential services; plain session/account metadata belongs in the non-encrypted plugin services.

## Default Query Rules

- Default track reads must filter `deleted_at IS NULL` unless the caller explicitly requests tombstones.
- Default collection reads must filter `deleted_at IS NULL` unless the caller explicitly requests tombstones.
- Default lyric reads must filter `deleted_at IS NULL` unless the caller explicitly requests tombstones.
- Default collection-item reads must return only items whose parent collection is not soft-deleted unless the caller explicitly opts in.
- Default play-source cache reads must return only rows whose status is `valid` and whose expiration has not passed unless the caller explicitly opts in.
- Reset helpers in each service must clear only their owned tables so tests and package consumers can reset one persistence aggregate without wiping unrelated data.
