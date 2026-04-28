# @b_be_bee/plugin
> Update this doc when plugin lifecycle APIs, host APIs, export surface, validation rules, or runtime boundaries change.

## Purpose

`packages/plugin/` owns the shared plugin contract for B_Be_Bee. It provides manifest parsing, package validation, integrity/signature checks, lifecycle and runtime orchestration, sandbox adapters, host API composition, permission enforcement, plugin registry helpers, and the `music-source` plugin contract.

## File Inventory

- `src/manifest.ts` - plugin manifest/model re-exports from `@b_be_bee/models`, plus host API and runtime callback types.
- `src/music-source.ts` - `music-source` plugin runtime interfaces, host context, error class, and runtime shape validation.
- `src/host.ts`, `src/host-api.ts` - host API implementation and public host-facing type exports.
- `src/runtime.ts`, `src/sandbox.ts`, `src/lifecycle.ts` - runtime orchestration, sandbox execution boundary, and lifecycle state transitions.
- `src/package.ts`, `src/validation.ts` - plugin package parsing, manifest validation, and static source policy checks.
- `src/registry.ts` - orchestration over `PluginRegistryService` for installed plugin metadata only.
- `src/permissions.ts` - manifest permission checks for network, auth/session, and proxy behavior.
- `src/integrity.ts`, `src/signature.ts` - checksum and signature validation helpers.
- `scripts/test.mjs` - package source validation entrypoint.
- `package.json` - export map, dependencies, and package scripts.
- `tsconfig.json` - package TypeScript configuration.

## Key Exports

- Root entrypoint from `src/index.ts`.
- `./manifest` for generic plugin manifests, lifecycle types, installed metadata, and host API shape.
- `./music-source` for music source plugin contracts and validation helpers.
- `./host` and `./host-api` for host API construction and public host API type exports.
- `./runtime`, `./sandbox`, and `./lifecycle` for loading, executing, and transitioning plugin runtime state.
- `./package`, `./validation`, `./permissions`, `./registry`, `./integrity`, and `./signature` for plugin installation and validation support.

## Dependencies

- Depends on: `@b_be_bee/database`, `@b_be_bee/models`, `@b_be_bee/logger`, `@b_be_bee/network`, and shared config from `@b_be_bee/configs`.
- Depended on by: desktop/mobile plugin host integrations and any package that validates, installs, or executes plugins.

## Runtime Boundaries

- `packages/plugin` orchestrates plugin runtime behavior but does not own persistence tables, model definitions, network transport internals, store state, or encrypted credential storage.
- Installed plugin metadata belongs to `PluginRegistryService`; source accounts, plugin sessions, and encrypted credentials remain separate database concerns.
- Pure plugin models, manifest metadata, installed metadata, music-source DTOs, and session-facing contracts belong to `@b_be_bee/models`; `packages/plugin` may re-export them for compatibility.
- Host auth/session APIs must use typed session-facing contracts from `@b_be_bee/models`.
- Keep imports on stable public package entrypoints such as `@b_be_bee/database/services/*`, `@b_be_bee/database/schemas/*`, `@b_be_bee/models`, and `@b_be_bee/network/*`.
- Do not import from database/store internals or duplicate persistence logic in this package.

## Music Source Plugins

- `music-source` plugins must provide `meta`, `MusicSourceCapabilities`, and the required login/library/audio-source methods before sandbox loading succeeds.
- `meta.pluginTypes` must be exactly `["music-source"]`; `meta.id` and `meta.version` must match the loaded manifest.
- Required methods are `init`, `login`, `logout`, `getSession`, `getHotTracks`, `getUserLibrary`, `trackToAudioInfo`, and `getAudioPlayInfo`.
- If a capability is `true`, the matching optional method group must be implemented. For example, `search` requires `searchTracks`, `lyrics` requires `getLyrics`, and `qualitySelect` requires `getAvailableQualities`.
- Use `Track`, `AudioPlayInfo`, `AudioQuality`, `PageParams`, `PageResult`, `PluginSession`, `MusicSourceContract`, and related model types from `@b_be_bee/models`.

## Host API Rules

- Plugins must perform network requests through the host API. Do not allow plugin code to call `fetch`, `XMLHttpRequest`, native HTTP modules, or internal network packages directly.
- Authenticated plugin network requests should use `useAuth: true`; the host API injects the current plugin session cookie/token from the typed auth provider.
- Network requests must pass manifest domain checks before reaching `@b_be_bee/network`.
- Plugins do not receive host storage APIs; persisted plugin data belongs to database/service packages.
- Auth/session access is allowed only when `manifest.permissions.auth` is true.
- Proxy selection is allowed only when `manifest.permissions.proxy` is true.

## Security Rules

- Do not log cookies, tokens, authorization headers, passwords, or raw credential payloads.
- Do not expose encrypted credential storage directly to plugin code.
- Do not let plugin code access filesystem APIs, process globals, native modules, app internals, or unapproved packages.
- Do not allow plugin code to import `packages/internal` or app package modules directly.
- Convert plugin-facing runtime and source errors into typed `PluginError` values where the music-source contract applies.

## Validation

- Run `pnpm run typecheck` in `packages/plugin` after changing public types, imports, exports, host APIs, or runtime wiring.
- Run `pnpm run test` in `packages/plugin` after changing manifest, music-source, validation, host, runtime, sandbox, package, or permission logic.
- If `package.json` dependencies change, run workspace install from the repo root before validating package typecheck.
