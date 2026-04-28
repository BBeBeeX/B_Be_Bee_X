# AGENTS.md

## Scope

Applies to `@b_be_bee/models`.

This package only defines shared TypeScript models, enums, constants, DTOs, and type contracts for B_Be_Bee.
Plugin manifest metadata, installed-plugin metadata, and music-source DTO contracts live here; plugin runtime validation and host APIs live in `@b_be_bee/plugin`.

Do not add UI, network, storage, database, player, plugin runtime, or platform-specific logic here.

---

## Principles

- Keep models pure and framework-independent.
- Prefer `interface`, `type`, `enum`, constants, and JSON-safe structures.
- Do not use React, React Native, Electron, Node filesystem, HTTP clients, or platform APIs.
- Keep persisted fields backward compatible.
- Prefer adding optional fields over renaming/removing existing fields.
- Do not change enum values once released unless a migration exists.
- Use `unknown` instead of `any` for raw source data.
- Do not store `Date`, `Map`, `Set`, functions, or class instances in persisted models.

---

## File Organization

Recommended structure:

```txt
models/
├─ enum.ts
├─ common.ts
├─ music.ts
├─ lyric.ts
├─ statistics.ts
├─ plugin.ts        # plugin session, manifest, installed metadata, and music-source contracts
└─ index.ts
````

`index.ts` should only re-export public models.

```ts
export * from "./enum";
export * from "./common";
export * from "./music";
export * from "./lyric";
export * from "./statistics";
export * from "./plugin";
```

---

## Naming

* Interfaces/types: `PascalCase`
* Fields: `camelCase`
* Use `duration: number // ms` or `durationMs`.
* Use `createdAt`, `updatedAt`, `expiresAt` as millisecond timestamps.

---

## IDs and Source Fields

Use stable deterministic IDs.

```ts
id: string; // `${source}:${sourceId}` or `local:${hash}`
source: string;
activeSource?: string | null;
sourceId: string;
sourceSubId?: string | null;
```

Rules:

* `id` is the app-level stable ID.
* `source` is the original source or plugin ID.
* `activeSource` is the currently selected fallback/source.
* `sourceId` is the source platform ID.
* `sourceSubId` is an optional secondary ID, such as Bilibili `cid`.

---

## Common Types

Prefer shared reusable types:

```ts
export interface Person {
  id?: string | null;
  name?: string | null;
  avatar?: string | null;
  raw?: unknown;
}

export interface Album {
  id?: string | null;
  title: string;
  cover?: string | null;
  releaseDate?: string | null;
  raw?: unknown;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

export interface PageResult<T> {
  items: T[];
  page?: number;
  pageSize?: number;
  hasMore: boolean;
  nextCursor?: string;
  total?: number;
}
```

### Pagination Specification

All list endpoints must support pagination.

**Requirements:**

* Loading large amounts of data at once is prohibited.
* If the platform uses page-based pagination, return `page` and `pageSize`.
* If the platform uses cursor-based pagination, return `nextCursor`.
* `hasMore` must accurately indicate whether there is more data available.

---

## Music Models

Use typed collection items instead of raw string arrays.

```ts
export interface CollectionItem {
  id: string;
  type: CollectionItemType;
  source?: string | null;
  sortOrder?: number;
  addedAt?: number; // ms timestamp
}

export interface AudioPlayUrl {
  url: string;
  headers?: Record<string, string>;
  expiresAt?: number | null; // ms timestamp
}
```

---

## Plugin Session Models

```ts
export interface PluginSessionCredentials {
  authType?: PluginAuthType;
  cookie?: string;
  token?: string;
  refreshToken?: string;
  headers?: Record<string, string>;
  expiresAt?: number | null;
  userId?: string | null;
  username?: string | null;
}

export interface PluginSession {
  pluginId: string;
  isLoggedIn: boolean;
  credentials?: PluginSessionCredentials;
  user?: Person | null;
  updatedAt: number; // ms timestamp
}
```

Never add password fields or real credentials.

### Security

Sensitive fields include:

```txt
cookie
token
refreshToken
headers.Authorization
```

Rules:

* Do not log sensitive fields.
* Do not add hardcoded cookies, tokens, passwords, or test credentials.
* Encryption/storage belongs outside `models`.

---

## Import Rules

Inside this package, use relative imports:

```ts
import { AudioQuality } from "./enum";
```

Do not import from the package root inside the same package:

```ts
import { AudioQuality } from "@b_be_bee/models/enum";
```

External packages may import from `@b_be_bee/models`.

---

## Backward Compatibility

When changing persisted models:

* Add optional fields.
* Avoid removing or renaming fields directly.
* Keep old fields temporarily with `@deprecated` comments.
* Add migrations outside this package if needed.

Example:

```ts
export interface LyricInfo {
  translations?: LyricTranslation[];

  /**
   * @deprecated Use translations instead.
   */
  translation?: string | null;
}
```

---

## Do Not Do

Do not add:

* UI logic
* React / React Native / Electron imports
* filesystem access
* HTTP requests
* database logic
* playback implementation
* plugin runtime logic
* real credentials
* non-JSON-serializable persisted fields
* source-specific required fields such as `biliCid` or `neteaseFee`

Use `raw?: unknown` for source-specific data.

