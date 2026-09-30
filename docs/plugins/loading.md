# Plugin Loading & Dynamic Registries

> **Legacy Reference:** Formerly `docs/03-plugin-system.md §6`.

## 6. Loading

Per [ADR-1 as amended](../architecture/overview.md#adr-1--plugins-are-statically-bundled-on-every-target),
there is **one loader on both targets**: the plugin graph is fixed at build time everywhere. The
thing a user adds at runtime is a music **source string**, which is data interpreted by
`plugin-source-runtime` ([06](../sources/spec.md)) rather than code handed to `ctx.plugin()`.

§6.2 documents the dynamic loader as a shelf design — worked out, not wired up — because the
decision to shelve it is reversible and the CSP problem it solves is not obvious.

### 6.1 Every target — `plugin-loader-static`

Metro cannot resolve a module path computed at runtime, so plugin imports must be statically
analysable. A codegen step (`pnpm gen:plugins`, run pre-build and in dev watch) scans the
workspace for packages containing a `BBeBee.plugin.json` and emits:

```ts
// apps/mobile/generated/plugins.ts — GENERATED, do not edit
import type { PluginRegistry } from '@BBeBee/kernel'

export const bundled: PluginRegistry = {
  '@BBeBee/plugin-player': {
    load: () => import('@BBeBee/plugin-player'),
    manifest: { /* … */ },
    builtin: true,
  },
  '@BBeBee/plugin-source-local': {
    load: () => import('@BBeBee/plugin-source-local'),
    manifest: { /* … */ },
    builtin: true,
  },
}
```

Configuration decides which of these are actually instantiated and with what settings. The loader
dynamically invokes `load()` on demand at startup, ensuring that unconfigured plugins are neither
fetched nor evaluated. The generated file is committed so a clean checkout builds without running
codegen first.

#### Concurrent Loading & Deferred Startup
To maximize startup performance without breaking Cordis DI lifecycle:
- **Concurrent `loadPlugins`**: Enabled plugins are instantiated concurrently with `Promise.all`
  rather than serialized one by one. Cordis resolves inter-plugin dependencies through `inject`
  declarations and tracks `PENDING` states, which natively supports out-of-order resolution.
  The serial plugin loading phase is compressed to the duration of the slowest single plugin.
  The `bootstrap` core services array remains strictly sequential.
- **Post-first-frame Deferred Loading**: Plugins non-essential to the initial UI frame (such as
  `plugin-local-scanner`, `plugin-download`, `plugin-share`, `plugin-visualizer`, `plugin-sleep-timer`,
  and `plugin-history`) are excluded from `INITIAL_ENABLED`. After the Shell mounts its first paint,
  the app invokes `app.loadPlugin(id)` during `requestIdleCallback` (or `setTimeout` fallback).
  As deferred plugins activate and register their views/routes onto `ctx.ui`, `ui/changed` fires and
  dynamically populates navigation entries without blocking the initial screen.


### 6.2 Desktop additions — `plugin-loader-dynamic`

> **Shelved, not built.** Nothing below is registered in either shell. It is kept because ADR-1's
> amendment is a scope decision rather than a technical one: if third-party *plugins* (as distinct
> from sources) ever justify the install flow, this is the design, and the reasons the obvious
> approaches fail are worth not rediscovering. Everything in it is gated behind
> [10 §M5](../roadmap/roadmap.md#m5--third-party-extensions-on-the-sandbox).

The renderer is sandboxed with `contextIsolation` on and a strict CSP, so it cannot `import()` a
`file://` path, and we are not willing to relax either. Instead, `main` would register a
privileged custom scheme:

```ts
// apps/desktop/main — registered before app ready
protocol.registerSchemesAsPrivileged([{
  scheme: 'BBeBee-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
}])
```

and serve it from the user plugins directory with path traversal rejected and a
`text/javascript` content type. The renderer's CSP would then read
`script-src 'self' BBeBee-plugin:`, and the loader is an ordinary dynamic import:

```ts
const mod = await import(/* @vite-ignore */ `BBeBee-plugin://${id}@${version}/index.js`)
await ctx.plugin(mod.default, config)
```

This would keep CSP enforceable, keep `nodeIntegration` off, avoid `new Function`, and — because
`import()` returns a real module — give correct ESM semantics including top-level await. Note what
it does *not* give: containment. The module lands in the renderer's realm, which is why the
version of this that ships (if one does) runs over `ctx.js` instead
([§7](#what-this-is-not)).

**Install flow.** Fetch → verify integrity hash → check `engines.BBeBee` against the app version →
extract to `plugins/<id>@<version>/` → read manifest → prompt for capability grants → write
`plugin_records` and `capability_grants` → `ctx.plugin()`. Update installs alongside and swaps
atomically. Uninstall disposes the fiber first, then removes the directory — never the reverse,
or the fiber's disposer may fail mid-teardown.

**Quarantine.** A plugin that throws during load twice consecutively is marked
`enabled = false` with `lastError` set and is skipped on subsequent boots until the user
re-enables it. Without this, a single bad third-party plugin becomes an unrecoverable boot loop —
the most common failure mode of runtime plugin systems. The same idea, applied to a rotted source
rather than a crashing plugin, is the stale badge in
[06 §7](../sources/authoring.md#7-errors) — with the deliberate difference that a stale source is
*not* disabled, because its cached catalogue is still worth browsing.

> ⚠️ Module caching means an updated plugin at the same URL will not be re-fetched.
> Versioned URLs (`<id>@<version>`) sidestep this; dev mode appends a cache-busting query.

### 6.3 The manifest

```jsonc
{
  "id": "@BBeBee/plugin-source-runtime",
  "version": "1.0.0",
  "displayName": "Music sources",
  "description": "Interprets imported source strings.",
  "engines": { "BBeBee": "^1.0.0" },
  "entry": {
    "main": "./dist/index.js",
    "ui": { "mobile": "./dist/ui.mobile.js", "desktop": "./dist/ui.desktop.js" }
  },
  "capabilities": [
    "net:host/*",           // narrowed per source to that source's allowlist — see §7
    "js",                   // evaluates source rules in ctx.js
    "db:read:core",
    "db:write:core",
    "secrets:own",          // one namespace per source id
    "fs:read:media"         // read cached artwork
  ],
  "contributes": {
    "settings": "./dist/settings-schema.js",
    "slots": ["settings.sources", "source.browse", "source.debug"]
  }
}
```

`entry.ui` is optional and per-target: a plugin may ship a desktop view and no mobile one. Shells
must render a placeholder rather than break when a contribution's view is missing for their
target — a direct cost of ADR-2, and one the UI registry makes explicit
([08 §3](../ui/architecture.md#3-resolving-a-descriptor-to-a-view)).

### 6.4 Configuration

One config document (YAML on desktop, JSON on mobile), read through `ctx.fs` before any feature
plugin loads:

```yaml
plugins:
  '@BBeBee/plugin-player':
    enabled: true
    config: { crossfadeMs: 0, prefetchNext: true }
  '@BBeBee/plugin-source-runtime':
    enabled: true
    config: { defaultRate: '2/1000' }
```

Editing config disposes and rebuilds only the affected fibers.

> **Music sources are not configured here.** They are rows in the `sources` table
> ([07 §4.1](../data-model/urn.md#41-sources-accounts-and-sessions)), imported and edited in the app,
> and `plugin-source-runtime` gives each one its own fiber inside its own `ctx.isolate('http')`
> scope (§5). Putting them in a config file would mean hand-editing JSON to add a server, and
> would make "import this string" a developer action
> ([06 §9](../sources/authoring.md#9-importing-updating-and-sharing)).

### 6.5 Hot reload

In development, `@cordisjs/plugin-hmr` watches the workspace and reloads changed plugins in place.
Because unload is total, this is genuinely equivalent to a restart for the affected subtree — the
audio graph, listeners, and timers of the old fiber are all gone. This works on desktop; on mobile
it composes with Metro Fast Refresh for the view layer while the kernel reloads underneath.

---

