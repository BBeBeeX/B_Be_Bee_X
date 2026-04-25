# packages/internal
> Update this doc when shared package boundaries inside `packages/internal/` change.

## Purpose

`packages/internal/` groups the core shared runtime packages used across platforms. Treat each child directory as an independently versioned workspace module boundary, even though they are developed together in this monorepo.

## File Inventory

- `database/` - Drizzle + SQLite access layer, migrations, and service modules.
- `logger/` - Electron and web logger shims.
- `models/` - shared domain model exports and enums.
- `network/` - HTTP client, cache, retry, proxy, and plugin validation helpers.
- `store/` - shared Zustand/TanStack Query state modules and hydration/reset helpers.
- `tracker/` - analytics abstractions and provider adapters.
- `utils/` - general-purpose helpers and platform/data-structure utilities.

## State Management

- **Jotai** for atomic state management across all platforms
- **Zustand** for complex state stores (in `packages/internal/store/`)
- **React Query** for server state management

## Database

- **Drizzle ORM** with SQLite for local data storage
- Platform-specific database implementations in `packages/internal/database/`
- Migration system with versioned SQL files

## Component Development Guidelines

- Shared UI components in `packages/internal/components/`
- Platform-specific components in respective app directories
- Use TypeScript interfaces for component props
- Follow cross-platform compatibility patterns
