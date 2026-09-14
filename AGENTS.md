# AGENTS.md — working on BBeBee

A guide for AI programming assistants. It is a distillation of `docs/`, which remains the
authority: when this file and `docs/` disagree, `docs/` wins and this file is the bug.

---

## 1. What this project is

BBeBee is a cross-platform music player — Electron on desktop, Expo/React Native on mobile —
built as a **plugin platform**, not an app with an extension API bolted on. The kernel is
[Cordis](https://github.com/cordiverse/cordis) (DI + plugin lifecycle), and *everything above the
kernel is a plugin*, including file I/O, networking, and persistence. Platform differences are
absorbed by **swapping which implementation of a core service is loaded**, never by branching
inside feature code.

**Music sources are not plugins.** A source is a JSON document the user imports as text — the
[legado](https://github.com/gedoor/legado) book-source model applied to audio — interpreted by one
built-in runtime (`plugin-source-runtime`) and sandboxed in its own QuickJS realm. Adding a
backend is a paste, not a release.

Two invariants carry the whole design. Learn these before touching anything:

> **1. No package outside `packages/core/*` may import a platform SDK.**
> Not `expo-*`, not `react-native`'s native modules, not `electron`, not `node:*`.
>
> **2. No package above Layer 2 may drive the kernel.**
> Feature and UI packages may be *typed* by `@BBeBee/kernel` (the pinned Cordis re-exports);
> they may not import `createApp`, the config loader, the plugin loader, the capability gate,
> the SQL guards, or the migration runner.

Both are enforced by `eslint.config.js` and by tests in `packages/kernel/src/`. A failure in
either usually means an architectural mistake, not a typo.

### Documentation map

Read `01` and `02` first — they establish the vocabulary everything else uses.

| # | Doc | Answers |
|---|---|---|
| 01 | `docs/01-overview.md` | What we build, what we deliberately don't, and the five ADRs |
| 02 | `docs/02-architecture.md` | The five layers, the runtime model per platform, the boot sequence |
| 03 | `docs/03-plugin-system.md` | What a plugin is, lifecycle, `inject`, loading, the capability model |
| 04 | `docs/04-core-services.md` | Every `ctx.*` service contract and its two implementations |
| 05 | `docs/05-audio-playback.md` | `ctx.audio`, `ctx.player`, the DSP chain |
| 06 | `docs/06-music-sources.md` | The source document, the rule language, the runtime, trust |
| 07 | `docs/07-data-model.md` | URNs, every table, the typed event map, migrations |
| 08 | `docs/08-ui-architecture.md` | One plugin, two shells: descriptors, hooks, tokens, and visual design |
| 09 | `docs/09-project-structure.md` | Layout, dependency rules, build pipelines, testing, workflow |
| 10 | `docs/10-roadmap.md` | Milestones with exit criteria, and the risk register |
| 11 | `docs/11-roadmap-M1.md` | The current milestone in detail |

---

## 2. Commands

```bash
pnpm install                 # pnpm 11+, Node 22.12+
pnpm check                   # typecheck + lint + test — the whole gate
pnpm check:changed           # typecheck + lint + test on diff only
```

`pnpm check` is the gate. If it passes, the build passes. Run it before declaring work done.
`pnpm check:changed` checks only packages and files affected by the current diff for rapid feedback.

| Command | Does |
|---|---|
| `pnpm check` | `typecheck` + `lint` + `test`. The one command before a PR |
| `pnpm check:changed` | `typecheck` + `lint` + `test` on packages and files in the current diff |
| `pnpm test` | Vitest once over every package |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm typecheck` | `tsc --noEmit` in every package and both apps (`pnpm -r typecheck`) |
| `pnpm lint` / `pnpm lint:fix` | ESLint, including the architectural rules |
| `pnpm build` | Emit `dist/` for every package under `packages/**` |
| `pnpm gen:plugins` | Regenerate `apps/*/generated/plugins.ts`. **Run after adding/removing a plugin** |
| `pnpm new:plugin` | Scaffold a plugin (see §6) |
| `pnpm dev:desktop` / `pnpm build:desktop` | Electron dev with HMR / production bundles |
| `pnpm dev:desktop:debug` | Desktop dev with debug mode enabled |
| `pnpm dev:mobile` / `pnpm dev:android` | Expo dev client (**not** Expo Go) |
| `pnpm dev:mobile:debug` / `pnpm dev:android:debug` | Same, with debug mode (`EXPO_PUBLIC_DEBUG=1`) |
| `pnpm test:ui` | Vitest with the browser UI |
| `pnpm clean` / `pnpm clean:all` | Remove `dist/`, `out/`, `*.tsbuildinfo` (and with `clean:all`, `node_modules`) |

Run a single package's tests by path: `pnpm test packages/core/core-fs-node`.

Mobile needs a **custom dev build** — `react-native-audio-api`, `expo-sqlite` and
`expo-file-system` contain native code, so Expo Go cannot host the app.

---

## 3. The layer model

**The filesystem is the layer model.** Every package lives at `packages/<layer>/<package>`, and
the layer directory is what `eslint.config.js` keys its rules off. Moving a package between
layers is a `git mv` that changes its rules in the same commit.

```
packages/protocol/    Layer 0 — contracts, zero runtime, zero dependencies
packages/kernel/      Layer 1 — Cordis Context, DI, fibers, config, loader, gate, migrations
packages/core/        Layer 2 — core capability services; the ONLY layer touching platform SDKs
packages/logs/        Layer 3 — log transports; the ONLY layer that may write to the console
packages/feature/     Layer 4 — headless business features
packages/ui/          Layer 5 — views and UI infrastructure  (apps/* are Layer 5 too)
packages/tooling/     outside the model — nothing here ships
```

Layer 3 is thin on purpose: three plugins that subscribe to `ctx.logger` and put the lines
somewhere — a ring buffer, a console, a rotating file. It sits above core because
`plugin-log-file` writes through `ctx.fs`, and below feature because **every layer above it logs
and none of them may know which transport is loaded** (docs/04 §16).

### "Depends on" means two different things

This is the distinction the box diagram cannot draw, and getting it wrong is the most common way
to break the architecture while appearing to follow it.

- **Layer 2 depends on Layer 1 by importing it.** `core-db-node` imports `MigrationRunner` and
  `scopeContext` from `@BBeBee/kernel` and calls them. That is intended.
- **Layers 3, 4 and 5 depend on Layer 2 *without importing it*.** A feature plugin writes
  `inject: ['fs', 'http']` — naming service keys declared at Layer 0 — and the kernel binds them
  to whatever the shell registered. There is **no compile-time import from a `plugin-*` to a
  `core-*` anywhere in the repository**, and the `package.json` files are the proof.
- **Layers 4 and 5 depend on Layer 3 the same way, through `ctx.logger`.** Cordis provides that
  service itself, already scoped to the plugin's name, so a feature plugin calls
  `ctx.logger.warn(…)` and never names a transport. `console.log` is not a smaller version of
  that — it skips the redactor and never reaches the ring buffer or the log file, which are what
  a bug report actually carries — so `no-console` is an error above Layer 3, and
  `conventions.test.ts` requires every feature plugin to call `ctx.logger` at all.

### Import matrix

| | L0 `protocol/` | L1 `kernel/` | L2 `core/` | L3 `logs/` | L4 `feature/` | L5 `ui/`, `apps/*` | Platform SDK |
|---|---|---|---|---|---|---|---|
| **L0** may import | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **L1** may import | ✅ | — | ❌ | ❌ | ❌ | ❌ | ❌ |
| **L2** may import | ✅ | ✅ all of it | own package | ❌ | ❌ | ❌ | ✅ **only here** |
| **L3** may import | ✅ | ⚠️ plugin surface only | ❌ *(service keys)* | a sibling transport | ❌ | ❌ | ❌ |
| **L4** may import | ✅ | ⚠️ plugin surface only | ❌ *(service keys)* | ❌ *(`ctx.logger`)* | types only, of a sibling | ❌ | ❌ |
| **L5** may import | ✅ | ⚠️ plugin surface only | ❌ *(service keys)* | ❌ *(`ctx.logger`)* | ⚠️ types only | ✅ | ⚠️ view lib in `ui/*`; chrome in `apps/*` |
| **Composition root** | ✅ | ✅ | ✅ | ✅ | ✅ (as data) | ✅ | ✅ |

`console.*` is an error everywhere above Layer 3, and available inside it: writing to the console
is what `plugin-log-console` *is*, and it is `plugin-log-file`'s last resort when the write it
exists to perform is the thing that failed. The shells are the one exemption — a boot failure can
happen before any transport has loaded, and the composition root is where the pieces do not exist
yet.

The kernel's **plugin surface** — the only kernel exports Layers 3, 4 and 5 may import — is exactly:
`Context`, `Service`, `Inject`, `Plugin`, `Fiber`, `Effect`, `EffectMeta`, `InjectSpec`,
`FiberState`, `FiberStateName`, `FiberStateValue`, `fiberStateName`, `isActive`, `isSettled`.
It is an **allow-list**, so a new kernel export is closed to Layers 3, 4 and 5 by default.
`packages/kernel/src/layers.test.ts` fails the build if the ESLint copy of that list drifts from
the re-export block at the top of `packages/kernel/src/index.ts`.

### The three deliberate exceptions

1. **UI packages import a view library** — `react-native` in `*-ui-mobile`/`ui-kit-mobile`,
   `react-dom` in the desktop halves. They still may not touch platform *capabilities*: a mobile
   view may render a `<FlatList>`, it may not call `FileSystem.readAsStringAsync`.
2. **Host shells own platform chrome** — deep links, safe-area insets, window controls.
3. **The composition root drives the kernel** — exactly four files, named by path in
   `eslint.config.js`:
   `apps/mobile/src/{boot,plugins}.ts` and `apps/desktop/renderer/{boot,plugins}.ts`.
   A fifth `createApp` call site fails `layers.test.ts`. A second bootstrap is a second kernel.

### Runtime model

Both platforms run **one JS runtime hosting one Cordis context**. On desktop the kernel lives in
the **renderer** (ADR-3); `apps/desktop/main` is a thin IPC host with **no domain logic** — it
does not know what a track is. HTTP routes through `main` because a renderer `fetch` cannot set
`Origin`/`Referer`/`Cookie`/`User-Agent` and is subject to CORS.

Desktop renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
and a strict CSP whose only concession is `'wasm-unsafe-eval'`, for QuickJS — no foreign
*JavaScript* loads.

---

## 4. Repository layout

```
apps/mobile/                Expo shell     — src/boot.ts, src/plugins.ts, generated/plugins.ts
apps/desktop/               Electron shell — main/ (IPC hosts), preload/, renderer/ (kernel + UI)
packages/protocol/          @BBeBee/protocol: services/, entities/, events.ts, conformance/
packages/kernel/            @BBeBee/kernel:  bootstrap/, config/, loader/, capability-gate/,
                                             migrations/, plus workspace-scanning tests
packages/core/core-*        one implementation per target per service key
                            (core-desktop-bridge backs desktop IPC/shell; core-store-fs backs
                            ctx.store; core-js-quickjs-node is ctx.js on desktop — mobile has
                            no sandbox yet)
packages/logs/plugin-log-*  the three transports: buffer, console, file
packages/feature/plugin-*   headless features; source-rules and toolkit (pure-logic libraries,
                            no Cordis, no I/O, no manifest); plugin-ui claims ctx.ui;
                            plugin-inspector claims ctx.inspector
packages/ui/                ui-tokens, ui-core, ui-parity, ui-kit-{mobile,desktop},
                            plugin-*-ui-{mobile,desktop} — including plugin-inspector-ui-desktop
                            and the plugin-sources / plugin-local-scanner UI pairs
packages/tooling/           tooling-gen-plugins, tooling-create-plugin, tooling-fixtures
sources/                    multi-file source development directory (source.json + source.js)
fixtures/sources/           compiled single-file example source documents; the golden corpus
scripts/                    developer and build scripts (e.g. scripts/sources/)
test/stubs/                 the three native modules Node cannot load, aliased by vitest.config.ts
```

Beyond the core services in §6, several **feature plugins claim service keys** of their own:
`ctx.player` (plugin-player), `ctx.sources` (plugin-sources), `ctx.scanner`
(plugin-local-scanner), `ctx.ui` (plugin-ui), `ctx.inspector` (plugin-inspector), and
`ctx.logBuffer` (plugin-log-buffer). Those keys are declared in `@BBeBee/protocol` like any
other; they are registered by their plugins, not by a `core-*` package.

### Naming

| Directory | Layer | Prefixes |
|---|---|---|
| `protocol/` | 0 | `protocol` |
| `kernel/` | 1 | `kernel` |
| `core/` | 2 | `core-<service>-<platform>` |
| `logs/` | 3 | `plugin-log-<sink>` |
| `feature/` | 4 | `plugin-<feature>`, `plugin-effect-<id>`, and the pure-logic libraries `source-rules`, `toolkit` (no manifest) |
| `ui/` | 5 | `plugin-<feature>-ui-<target>`, `ui-*` |
| `tooling/` | — | `tooling-*` |

There is deliberately **no `plugin-source-<protocol>` prefix**. A music backend is a document,
not a package. The only two packages with `source` in the name are `plugin-source-runtime` (the
interpreter) and `plugin-source-local` (files on disk, which have no HTTP to describe).

---

## 5. Writing a plugin

### Check the toolkit first

Before writing a helper — an id derivation, a normaliser, a duration format, a shuffle — check
whether `@BBeBee/toolkit` already has it, and import it instead of growing a second copy inside a
plugin. Duplicated helpers drift: two `formatDuration`s mean two spellings of the same two-hour
track, on two platforms. This applies to **modifying** existing code under `packages/feature/` as
much as to new plugins — when a change needs a pure function, `toolkit` is the first place to
look, and the right place to put it when it is genuinely new (pure, no Cordis, no I/O, no
`ctx.*`; the charter is `packages/feature/toolkit/README.md`).

### Shape

```ts
import type { Context } from '@BBeBee/protocol'

export const name = 'plugin-media-keys'
export const inject = ['player', 'device']

export async function apply(ctx: Context) {
  const off = ctx.device.onMediaKey((k) => { /* … */ })
  return () => off()          // the returned disposer is the plugin's teardown
}
```

Or a `Service` subclass when the plugin claims a service key (`super(ctx, 'player')` claims
`ctx.player`; `async [Service.init]()` runs after construction and dependents stay blocked until
it resolves).

> ⚠️ **Plugin entry points must be `async function`, an arrow function, or method shorthand.**
> Cordis decides "is this a class?" with `!!func.prototype`. A plain `function apply(…)` has one,
> so it is `new`-ed as a service and **the disposer it returns is discarded** — the plugin loads,
> works, and never unloads. `conventions.test.ts` fails the build on the wrong shape.

### Every side effect goes through the fiber

Anything a plugin starts, it must register so the fiber can stop it.

```ts
// ❌ Looks right; the effect is still registered after unload.
export async function apply(ctx: Context) {
  return ctx.dsp.registerEffect(effect)
}

// ✅ Wrapped in a local closure, which is what the fiber collects.
export async function apply(ctx: Context) {
  const off = ctx.dsp.registerEffect(effect)
  return () => off()
}

// ✅ Several disposables — generator form; they unwind in reverse.
export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.on('player/track-changed', onTrack)
    const timer = setInterval(tick, 30_000)
    yield () => clearInterval(timer)
    yield ctx.ui.registerSlot('now-playing.actions', descriptor)
  }, 'scrobbler')
}
```

Why the wrap matters: services are reached through Cordis's tracing proxy, so a disposer returned
straight through it is not the function the fiber collects.

Anti-patterns, each producing a plugin that cannot be disabled: a bare
`window.addEventListener`; a `setInterval` nobody clears; module-level mutable state that survives
reload; a floating `;(async () => { await longRunningScan() })()`. For long async work, take an
`AbortController` and abort it in the disposer.

### Dependencies

`inject` is a declaration of need, not an import. Load order is *derived* from it; nothing
sequences plugin startup by hand, and a fiber stays `PENDING` until every injected service is
`ACTIVE`.

- **Everything named in `inject` is required**, in both the array and object forms. In the object
  form the value is that service's *intercept config*; `null` means "no interception config", not
  "optional". Pinned by `packages/kernel/src/cordis-assumptions.test.ts`.
- **Optional dependency = a nested `ctx.inject([...], …)`** (or the `@Inject` decorator on a
  service method). The outer plugin activates immediately; only the inner block waits.
- Inject the **narrowest** set that is genuinely required. A plugin that injects `db` to read one
  setting should inject `store` instead, so it stays loadable when the database fails to open.

`@Inject` is a **2023-11 standard decorator**, not the legacy TypeScript form: `target: ES2022`,
no `experimentalDecorators`, Babel `@babel/plugin-proposal-decorators` `{ version: '2023-11' }`.

### Services

- Don't cache a service reference across an `await` in a long-lived variable — read `ctx.fs` each
  time; it is a property access.
- Identity comparisons on service objects are unreliable. Compare by `name`.
- **The one exception — capturing for teardown.** A disposer runs while its own fiber is already
  `UNLOADING`, and reaching through the context there throws. So a plugin that must flush on
  shutdown captures at load time — permitted only when (1) the captured service is a *core*
  service, (2) the reference is used *only* in the disposer, and (3) failure is swallowed. A
  comment must say so at the capture site.

### Isolation and interception

- `ctx.isolate(key)` — a private instance of one service for a subtree. Each imported source gets
  its own `ctx.isolate('http')`: its own cookie jar, rate limiter, and host allowlist.
- `ctx.intercept(key, config)` — same instance, different configuration. This is how the
  capability gate and per-plugin `store`/`fs` namespaces are implemented.

### Checklist

- [ ] Existing helpers imported from `@BBeBee/toolkit` where it has them, and any new
      domain-free helper added *to* toolkit rather than into the plugin — no second `stableId`,
      no second `formatDuration` (§5 "Check the toolkit first").
- [ ] `name` set, matching the package name's suffix.
- [ ] `inject` lists exactly what is needed.
- [ ] No platform SDK imported. No `core-*` package imported — a Layer 2 dependency is spelled
      `inject: ['fs']`.
- [ ] Nothing from the kernel's bootstrap surface.
- [ ] Every listener, timer, socket and audio node registered through `ctx.effect()` or returned
      as a disposer; long async work takes an `AbortSignal`.
- [ ] No module-level mutable state.
- [ ] It logs, and it logs through `ctx.logger` — never `console.*`, which skips the redactor and
      reaches neither the ring buffer nor the log file.
- [ ] `Config` schema present if configurable, with defaults.
- [ ] `BBeBee.plugin.json` declares the **minimum** capabilities that work.
- [ ] Own tables declared via `ctx.db.defineSchema('plugin:<id>', …)`.
- [ ] It is a plugin at all — a new music backend is a **source string**, not a package.
- [ ] Disable, re-enable, and confirm via `fiber.getEffects()` that nothing leaked.

### Scaffolding

```bash
pnpm new:plugin --name scrobble --kind feature --ui desktop --capabilities db:own
pnpm install        # link the new workspace package
pnpm gen:plugins    # add it to both shells' static registries
pnpm check
```

`--kind` is `feature` (default) or `effect`; there is no `source` kind. `--ui` is
`none|desktop|mobile|both`. The headless package lands in `packages/feature/`, its views in
`packages/ui/` — that placement is the scaffolder's most consequential output, because the lint
rules key off the layer directory.

**The generated registry is committed.** After adding or removing a plugin, run `pnpm gen:plugins`
and commit the diff; a stale `apps/*/generated/plugins.ts` is a review finding.

---

## 6. Core services and capabilities

Service interfaces live in `packages/protocol/src/services/` and are applied to the context by
module augmentation. Implementations live in `packages/core/*` and are the sole holders of
platform dependencies. **A core plugin holds no domain knowledge** — `ctx.fs` moves bytes,
`ctx.db` runs SQL, neither knows what a track is. If a feature needs something not in `docs/04`,
the answer is to add a core service, never to import a platform SDK.

Keys: `ctx.fs`, `ctx.http`, `ctx.ws`, `ctx.store`, `ctx.db`, `ctx.secrets`, `ctx.mediaSession`,
`ctx.notify`, `ctx.background`, `ctx.paths`, `ctx.device`, `ctx.crypto`, `ctx.codec`, `ctx.shell`,
`ctx.i18n`, `ctx.logger`, `ctx.audio`, `ctx.js`.

Plugins never handle absolute paths: they ask `ctx.paths` for a well-known directory
(`data | cache | temp | music | downloads | logs`) and resolve relative to it, producing opaque
`Uri` values.

### Capability grammar

Declared in each package's `BBeBee.plugin.json`, mediated by the kernel via interception:

| Capability | Grants |
|---|---|
| `fs:read:<scope>` / `fs:write:<scope>` | `own`, `media`, `cache`, `downloads`, or `all` |
| `net:host/<glob>` | Outbound HTTP **and** WebSocket, plus a per-plugin persisted cookie jar |
| `db:own` | Its own `{{ns}}_`-prefixed tables outright — read, write, schema |
| `db:read:<ns>` / `db:write:<ns>` / `db:*:<ns>` | Another namespace, by verb. **The verbs do not nest**: reading and writing the catalogue is `db:read:core` *and* `db:write:core` |
| `secrets:own` | Its own credential namespace. There is no `secrets:all` |
| `js` | May evaluate untrusted script in `ctx.js`. Held by `plugin-source-runtime` and nothing else |
| `audio`, `mediaSession`, `notify`, `shell`, `background` | Audio graph / OS-level actions |

Refused whatever was granted: statements the gate cannot attribute to a table
(`DROP INDEX …`, `VACUUM`, `ANALYZE`), schema-qualified names (`main.foo`), and `PRAGMA` beyond
`defer_foreign_keys` and read-only introspection.

> ⚠️ **The capability model is defense in depth, not a sandbox.** Plugins share the app's JS
> realm. It raises the cost of *accidental* overreach and makes intent auditable; it does not
> contain a hostile plugin, and is not asked to — every plugin is first-party and ships in the
> build. On desktop the gate runs renderer-side while the real `fs`/`db` live in `main`, so it
> constrains a *cooperating* plugin. Real containment is `ctx.js`, and it exists for source
> documents.
>
> When a capability error appears: **widen the manifest, never the gate.**

---

## 7. Data model

- **URN**: `BBeBee:<sourceId>:<kind>:<id>`, e.g. `BBeBee:local:track:9f2c8a1e`. `kind` is
  `track | album | artist | playlist | genre`. `parseUrn` splits on the first three colons only,
  so source-local ids may contain colons. The source id is derived from `sourceUrl`
  (slugified host + first 8 hex of SHA-256).
- **The same song on two sources is two rows with two URNs**, joined by `track_links` — never one
  merged row. The unified library merges at *display* time; storage stays faithful.
- SQLite, `journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`.
- Timestamps are **epoch milliseconds** as `INTEGER`. Booleans are `INTEGER` 0/1. JSON columns are
  `TEXT` with a `_json` suffix. Tables mirroring remote data carry `fetched_at`.
- Foreign keys to catalogue rows are URN `TEXT`, not integer ids.
- **Migrations are forward-only**, namespaced (`core` or `plugin:<id>`), recorded in
  `schema_migrations`. Each migration's statements and its bookkeeping row **commit together in
  one transaction** — without that, an interruption leaves tables created and the version
  unrecorded, and the database is permanently unbootable. `MigrationDb` requires `transaction()`.
- **One statement per `up` entry.** A driver compiles the first statement of a string and
  discards the rest silently, so multi-statement strings are refused before anything executes.
  That is what the array form is for.
- A plugin may only `defineSchema` for its own instance id, and `{{ns}}` expansion is lossy
  (`-`, `.`, `_` all fold to `_`), so `schema_namespaces` records ownership and a second claimant
  is refused with `NamespaceCollisionError`.

### Events

Declared once in `@BBeBee/protocol` by augmenting Cordis's `Events`. **The dispatch mode is part
of the contract.** Waterfalls are the horizontal composition mechanism:

| Hook | Purpose |
|---|---|
| `player/before-resolve` | `plugin-download` substitutes a local file; failover retries a linked URN |
| `http/request` | The source runtime injects headers/cookies; cache, rate limit, retry |
| `dsp/build-chain` | Each effect inserts its segment at its configured position |

The payoff: **the player has no concept of downloads.** Uninstall `plugin-download` and playback
keeps working, streaming instead — nothing in `plugin-player` changes or even knows.

> ⚠️ **A waterfall's `next` takes no arguments.** Cordis closes it over the *original* argument
> list, so `next(somethingElse)` is silently identical to `next()`. A listener either **mutates
> the argument in place** and calls `next()`, or **short-circuits** by returning a value and never
> calling `next`. Pinned by `cordis-assumptions.test.ts`.

`player/position` is emitted at 1 Hz and the UI interpolates with rAF; never poll it.

### State ownership

Each piece of state has exactly one owner: catalogue rows → `ctx.db` written via `ctx.sources`;
transport and queue → `ctx.player`; audio nodes → `ctx.audio`; effect params → `ctx.dsp`; tokens
and source vars → `ctx.secrets`, per source id; UI contributions → `ctx.ui` (read-only from
shells); plugin config → the kernel. **React holds no domain state** — only view state.

---

## 8. UI

### The three-package convention

```
@BBeBee/plugin-scrobble               ← headless (L4): service, state, events, persistence
@BBeBee/plugin-scrobble-ui-mobile     ← React Native views (L5)
@BBeBee/plugin-scrobble-ui-desktop    ← React DOM views (L5)
```

> **A UI package contains no logic that would need to be written twice.**

If you are about to write the same `if` in both UI packages, it belongs in the headless one.
View packages import the headless package for **types only**. In practice they end up thin:
layout, gestures, event wiring.

### Descriptors, not components

Plugins never hand components to the shell. They register serialisable **descriptors** — `route`,
`slot`, `command`, `settings`, `menu` — and each shell resolves the name against its own registry
via `ctx.ui.registerView(id, component)`. `registerView` takes `unknown` deliberately:
`@BBeBee/protocol` must not depend on React. Shells must render a placeholder, not break, when a
contribution has no view for their target.

> ⚠️ **Register a component bound to your own `ctx`, not the shell's.** The shell renders views
> with the context it was mounted on (`app.ready(['ui'])` — `ui` injected and nothing else), and a
> cordis context throws for any property outside its inject list. Reading `ctx.player` or
> `ctx.inspector` off the forwarded prop throws during render; every view package closes over its
> own plugin context with a local `bound(ctx, Screen)` for exactly this reason.

### Hooks

`@BBeBee/ui-core` provides `useService` and `useServiceState(key, events, select)` over
`useSyncExternalStore`. Feature-specific hooks (`useTransport`, `useQueue`, `usePosition`) live in
the **headless** package so both shells share them. `select` must be referentially stable.

Rendering rules: no `useEffect` for domain work (call a service method); optimistic updates live
in the service so both shells behave identically on rollback; lists virtualise (`FlashList` on
mobile, `@tanstack/react-virtual` on desktop); artwork renders `blurhash` first, and artwork with
no cover at all renders an identicon generated from the entity URN.

Tokens are **data, not components** (`@BBeBee/ui-tokens`, which also holds the WCAG AA contrast
gate). Component parity between the two kits is a contract: both export the same component names
with the same props, and `ui-parity` fails CI on divergence — without it the kits drift silently
and every plugin author pays. Accessibility is not a phase-two concern.

### Visual design language and style guide

The visual presentation is an **immersive, dark-first streaming media aesthetic** (docs/08 §6):

- **Surface hierarchy (luminance stepping, not borders)**:
  - `bg.sunken` (`#000000`): Outer chassis, desktop sidebar/navigation rail, persistent bottom transport bar.
  - `bg.base` (`#121212`): Main content canvas and scrollable lists.
  - `bg.raised` (`#181818`): Media cards (album/playlist tiles) and elevated panels.
  - `bg.overlay` (`#282828`): Modal dialogs, context menus, tooltips, and row/card hover states.
  - `border.subtle` (`#282828`): Structural dividers; `border.strong` (`#7A7A7A`): Accessible focus outlines.
- **Signature accent & contrast rules**:
  - `accent.base` (`#1DB954`): High-vitality green for play buttons, active row titles, track scrubber fill, and toggles.
  - `accent.on` is **black (`#000000`)**: Text or icons rendered on top of green fills must be black to meet WCAG AA (>8:1 contrast). Never place white text on green.
  - Text hierarchy: `#FFFFFF` (`text.primary`) for titles and active items; `#B3B3B3` (`text.secondary`) for artists, album names, durations, and column headers; `#6A6A6A` (`text.disabled`).
- **Typography (geometric grotesque)**:
  - Stack: `"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
  - Weight follows size: Display and XL headings use heavy `900` or bold `700` with tight line-height (`1.2`); track titles use bold `700` or medium `500`; secondary metadata uses regular `400`.
- **Shapes & micro-interactions**:
  - Controls are **pills (`radius.pill: 999`)**; primary buttons grow slightly on hover (`scale(1.04)` over `120ms`) to provide tactile feedback against dark canvases. Icon buttons are circular.
  - Media cards (`radius.md: 8`, square artwork `radius.sm: 4`) reveal a floating circular green play button (`48px`, `#1DB954`, black play glyph) in the bottom-right corner of the cover on pointer hover.
  - Track rows (`56px` height) show index/play button toggle on hover, highlight to `#282828`, and illuminate active playing track titles in vibrant green (`#1DB954`) with an audio equalizer icon.
  - Seek scrubbers and volume sliders use a subtle grey track that fills with green (`#1DB954`) and reveals a circular thumb on hover/drag.
- **Artwork & atmospheric theming**:
  - Square artwork for tracks and albums; circular avatars for artists.
  - Artwork renders `blurhash` first, with fallback to `artworks.dominant_color` to prevent grey flashes or layout shifts. With no cover at all, `Artwork` generates a GitHub-identicon-style square from the entity URN (`identicon()` in `ui-core`; a `seed` prop on both kits); real data always outranks generated — image > `dominant_color` > identicon > plain colour.
  - Playlist and album detail hero banners extract `artworks.dominant_color` to generate a dynamic atmospheric vertical gradient fading into the `#121212` base canvas.
- **Layout paradigm**:
  - Desktop: 3-pane layout — sunken `#000000` sidebar/rail, rounded `#121212` content card with dynamic hero header gradient, and full-width persistent sunken `#000000` / `#181818` bottom transport bar.
  - Mobile: Full-bleed dark screens with bottom tab bar, persistent floating mini-player, and expandable full-screen now-playing sheet.

---

## 9. Music sources

`plugin-source-runtime` is the **only** code that talks to remote music backends. It claims no
service key; it reads the `sources` table and registers one `MediaProvider` into `ctx.sources`
per enabled row, each in its own fiber inside its own `ctx.isolate('http')` scope.

- `MediaProvider` is an **internal** interface with exactly two implementations (the runtime's
  per-source adapter and `plugin-source-local`). It is not an extension point. Nobody outside
  this repository implements it — they write a source document.
- **Capabilities are derived, not declared** — computed from which rule blocks the document
  contains. `ruleStream` is the one required block. A present-but-empty block counts as absent.
- The rule language: prefixes pick the engine (`@css:`, `@json:`, `@xpath:`, `@js:`, `=` literal;
  bare rules are inferred). **A rule is a selector unless it starts with `=`** — the URL template
  fields `searchUrl`/`exploreUrl` are the only exception. `{{ }}` is a **path, not an
  expression**; only `{{@js:…}}` reaches the sandbox. The engines that evaluate today are
  template, JSONPath, regex and literal (plus `@js:` where a sandbox exists); `@css:`/`@xpath:`
  parse but raise `RuleEngineUnavailableError` (docs/06 §3.1).
- Combinators: `||` first non-empty, `&&` concatenate, `%%` interleave, `##pat##repl##` replace.
- `packages/feature/source-rules` is **pure logic** — no Cordis, no platform, no I/O. ESLint bans
  `cordis` and `@BBeBee/kernel` there specifically. Every fetch belongs to the runtime.
- `ctx.js` is QuickJS, not `node:vm`: no ambient globals, values cross by **cloning** never by
  reference, and limits are enforced by the engine. It is injected via a nested
  `ctx.inject(['js'], …)` so a build without a sandbox degrades rather than failing to boot.
- The sandbox bounds reach, not intent — it is paired with a **per-source host allowlist** on
  `ctx.http`, enforced before *and* after the `http/request` waterfall so a listener cannot
  launder a host.
- Credentials never live in the document. Export must be shareable as-is.
- **Qualities**: `StreamRule` and `SourceDocument` support explicit `qualities?: StreamQuality[]` ('low' | 'normal' | 'high' | 'lossless' | 'hi-res'). The runtime prioritizes `ruleStream.qualities ?? doc.qualities` before falling back to heuristics.
- **Dynamic Stream Headers**: Stream playback requiring custom referrers or user agents registers them dynamically via the desktop IPC bridge `stream:set-headers` (`window.BBeBee.stream.setHeaders({ url, headers })`), avoiding hardcoded domain intercepts in the core.

### Source authoring and workflow
- **Development (Dual-file)**: complex sources live in `sources/<id>/`:
  - `source.json`: metadata, allowedHosts, rules (ruleSearch, ruleStream, ruleArtist, rulePlaylist, ruleLibrary, etc.)
  - `source.js`: unescaped JavaScript library code with full IDE syntax highlighting and linting
- **Build (Single-file)**:
  - `pnpm build:sources` runs `scripts/sources/cli.ts` to validate and compile `sources/` into self-contained single-file JSONs in `fixtures/sources/`.
  - `pnpm watch:sources` monitors `sources/` and recompiles on file changes.
  - `node --experimental-strip-types scripts/sources/cli.ts --unpack <file> [dest]` unpacks any single-file source back into dual-file development format.
- Adding a source for an end user is not a development task: **Settings → Sources → Import**, paste, review,
confirm. Single-file documents this repo ships live in `fixtures/sources/`.

---

## 10. Testing

| Layer | What it covers |
|---|---|
| **Unit** | Pure logic: URN parsing, fractional indexing, the transport state machine against a mock `AudioService` |
| **Conformance** | Every `core-*` implementation against the shared suite in `packages/protocol/src/conformance/`. **The most important layer** |
| **Integration** | A real Cordis context, real feature plugins, fake core services: load order, waterfall composition, unload completeness |
| **Source corpus** | Every document in `fixtures/sources/` replayed in vitest, responses recorded inline in the runtime tests |
| **Device smoke** | Manual, per release: lock screen, Bluetooth, headphone unplug, incoming call, background survival |

Two tests encode the architecture's central claims: the **leak test** (`snapshotContext` before
`ctx.plugin()`, `fiber.dispose()`, snapshot equal after — run parameterised over *every* plugin in
the workspace) and **"the player plays the same track with and without `plugin-download`"**.

Test conventions in this repo:

- Tests live beside their subject as `*.test.ts` / `*.test.tsx` under `src/`; vitest's include
  globs are `packages/*/*/src/**/*.test.{ts,tsx}`, `packages/*/src/**/*.test.{ts,tsx}` — Layers 0
  and 1 are packages, not directories of packages — `apps/*/**/*.test.ts`, and `scripts/**/*.test.ts`.
- Environment is `node`. A test needing a DOM opts in per file with `// @vitest-environment jsdom`
  — `environmentMatchGlobs` was removed in Vitest 4 and failed silently.
- `test/stubs/` aliases the three native modules Node cannot load: `react-native-audio-api` throws
  on anything genuinely native; `expo-sqlite` and `expo-file-system` really work, so the gate is
  shown to hold on both drivers.
- `no-restricted-imports` is **off** in `*.test.*` — a conformance harness legitimately needs
  `node:fs`.
- `testTimeout` is 10 s: a plugin that never settles should fail loudly rather than hang.

### What each gate catches

| Gate | Catches |
|---|---|
| `no-restricted-imports` | A plugin reaching for a platform SDK instead of a `ctx.*` service |
| Conformance suites | Two implementations of one service drifting apart |
| `*-scope` suites | A capability gate that holds on one platform and not the other |
| Leak test | A plugin that does not unload cleanly |
| `conventions.test.ts` | An un-awaited `ctx.plugin()`, or a plugin entry declared as a plain `function` |
| `layers.test.ts` | The kernel plugin surface drifting from the ESLint allow-list; a fifth `createApp` call site |

---

## 11. Before finishing a change

- [ ] `pnpm check` clean.
- [ ] `pnpm gen:plugins` produces no diff.
- [ ] A new plugin passes the leak test.
- [ ] A new core service implementation passes its conformance suite **and its `*-scope` suite on
      every implementation of that service**, not only the one you changed.
- [ ] No new import that the layer rules would have to be widened to permit. If you are tempted to
      widen `eslint.config.js`, stop — that is the architecture failing, not the lint config.
- [ ] `docs/` updated when behaviour or a contract changed. The docs are the spec, and the
      TypeScript blocks in them are intended to compile.
- [ ] Version matrix in `docs/09 §5` updated if a dependency moved.
- [ ] If the rule engine changed, the source corpus is green — and if a fixture had to be
      re-recorded, say why, because a silently re-recorded fixture hides a real behaviour change.

---

## 12. Gotchas

| Symptom | Cause |
|---|---|
| Metro: cannot resolve `cordis` | `unstable_enablePackageExports` missing from `metro.config.js` — Cordis is ESM-only with an `exports` map |
| `@Inject` fails at runtime, compiles fine | Legacy decorators. Babel needs `{ version: '2023-11' }`; `tsconfig` must not set `experimentalDecorators` |
| A plugin sits in `PENDING` for ever | An injected service never became `ACTIVE`. `ctx.inspector.render()` prints the tree and names what each fiber waits for |
| `app.start()` resolves but a service is not ready | An un-awaited `ctx.plugin()`. `pnpm test packages/kernel` names the file |
| A plugin still works after unload | The disposer came back through a service proxy unwrapped, or the entry point is a plain `function` |
| `CapabilityError: … may not …` | The manifest is missing a capability, or the path/table is genuinely out of scope. Widen the manifest, never the gate |
| `CapabilityError: host … not allowed` from a source | The document's rules reach a host it did not declare. Add it to `allowedHosts` and re-import, so the user sees it |
| A source returns nothing, with no error | A rule matched nothing where the field was optional. The test screen shows what the backend actually answered |
| `JsTimeoutError` in a source | An `@js:` block looped, or awaited a request that never resolved. Limits are per evaluation and not configurable per source |
| Renderer: preload bridge is missing | The renderer loaded without `preload/index.cjs` — rebuild, since preload must be CJS |
| Electron will not launch on a headless machine | Expected. It needs `libgtk-3`, `libnss3` and a display; the bundles still build |
| A `.tsx` test fails with `Element is not defined` | Missing `// @vitest-environment jsdom` at the top of the file |

---

## 13. Where the project stands

**M0 and M1 are built; M2 (sources as strings) is built except where named below.**

- M1: `core-audio-webaudio` with its conformance suite, both `core-codec-*`, both `core-http-*`
  against a real byte-serving socket, `ctx.device`, `ctx.background` and `ctx.mediaSession` on
  both targets, the scanner, the catalogue, the player (gapless, crossfade, prefetch, the
  interruption table), both UI kits with the parity check, and five screens on both shells.
  Both shells load the **generated** registry.
- M2: `source-rules` (full rule engine with its own tests), `core-js-quickjs-node`, the runtime
  with search/explore/album/lyrics/login (`DocumentAuth`, single-flight re-auth), `ctx.secrets`
  on both targets with persistent per-source cookie jars, the import/review flow, the per-feature
  test screen with its streaming trace, the cross-source search screen (one result section per
  source, failures and timeouts kept visible) (`plugin-sources-ui-*`), and the corpus suite over
  `fixtures/sources/`
  (`direct-url.json`, `subsonic.json`, `podcast-json-feed.json`).
- Also built: the three log transports (`plugin-log-{buffer,console,file}`), `plugin-ui`
  (`ctx.ui`), `plugin-inspector` (`ctx.inspector`), `core-desktop-bridge`, `core-store-fs`.

Known gaps, so they are not rediscovered as bugs:

- **The Stage 0 audio spike has not been run on hardware** — no iOS device, no Android device, no
  Electron. ADR-4's verdict is still a hypothesis, as is the device smoke matrix.
- **`load({ strategy: 'stream' })` has no mobile implementation.** React Native has no
  `HTMLMediaElement`, so a long remote track is buffered or not played.
- **`core-js-quickjs-expo` does not exist** — Hermes has no WASM. `ctx.js` on mobile needs a
  native QuickJS module. Tracked as the M2 gap.
- **`@css:` and `@xpath:` rule engines are not implemented** — the parser recognises the
  prefixes and documents using them import cleanly, but evaluating such a rule raises
  `RuleEngineUnavailableError` (docs/06 §3.1).
- **No first-party plugin ships its own schema** — everything bundled reads/writes core tables
  via `db:read:core`/`db:write:core`; the `ctx.db.defineSchema` machinery is implemented and
  tested but unused (docs/07 §6).
- **`mediaSession`, `background`, `notify`, `shell` and `secrets:own` capabilities are
  declarative** — the grant is recorded but nothing enforces it yet.

### Where this repo differs from `docs/` today

Reality, not aspiration — check before relying on a doc statement:

- **No Turborepo and no `turbo.json`.** The root scripts orchestrate with `pnpm -r`.
- **No `pnpm source:check` / `pnpm source:record`.** Planned for M2 cleanup; until then the
  corpus responses are recorded inline in `plugin-source-runtime`'s tests.
- **No CI config in the repo.** `pnpm check` is the gate you run yourself.
- **Layers 0 and 1 are single packages, not directories of them** — `packages/protocol/src` and
  `packages/kernel/src` sit one level shallower than `packages/<layer>/<package>/src`. The vitest
  include globs and the kernel tests' own `workspaceRoot` both have to carry both shapes; when
  they carried only the deep one, every kernel and protocol test silently stopped being collected
  and the run stayed green.
- **Pinned versions drift from the `docs/09 §5` matrix in both directions** — `typescript` is
  5.9.3 (the matrix used to say 7.0.2) and `vite` is ^7.3.6 (the matrix used to say 8.2.2).
  Read `package.json` and `pnpm-lock.yaml` as the authority on versions.
- `cordis` is pinned exactly at `4.0.0-rc.9` — **no caret, no tilde**. It is a release candidate
  whose API may change without notice. Upgrades are deliberate, manual, and their own commit.
  Plugins import Cordis types **from `@BBeBee/kernel`**, never from `cordis`, so one adapter
  absorbs an upstream change instead of forty packages.
