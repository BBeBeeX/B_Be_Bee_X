# 01 — Overview & Decisions

> **What this answers.** What BBeBee is, what it deliberately is not, which platforms it targets,
> and the four architectural decisions that everything downstream depends on. If you read one
> document before writing code, read this one and [02](./02-architecture.md).

---

## 1. What we are building

A music player that runs on desktop and mobile from one codebase, where the player itself is
thin and nearly all behaviour arrives as plugins.

The user-visible product is ordinary: a library, a queue, playback with an equalizer, offline
downloads, playlists, lyrics, and the ability to pull music from more than one place — a folder
of files on disk, a self-hosted server, a streaming service. What is unusual is the shape
underneath: there is no privileged "core" that owns those features. The library is a plugin. The
downloader is a plugin. So is the filesystem access the downloader uses.

### Why build it this way

Three reasons, in order of importance:

1. **Cross-platform without conditionals.** The alternative to a service abstraction is
   `Platform.OS === 'ios' ? … : …` scattered across the codebase, which decays quickly. Here,
   platform difference is expressed once, as *which plugin got loaded*, and never again.
2. **Music sources are inherently plural and unstable.** Every streaming backend has a different
   API, different auth, different pagination, and a different lifespan. A source has to be
   addable and removable without touching the player. This forces a real SPI
   ([06](./06-music-sources.md)) rather than an internal interface that happens to have one
   implementation.
3. **Lifecycle correctness is hard, and Cordis already solved it.** Plugins that register event
   listeners, open sockets, hold audio nodes, and start timers must tear all of that down when
   disabled. Cordis's fiber/effect model makes unload total by construction, which is the part
   most plugin systems get wrong.

### Goals

- One plugin graph that runs unmodified on iOS, Android, and desktop.
- A plugin can be disabled at runtime and leave no trace — no listeners, no timers, no sockets.
- Adding a music source requires touching exactly one new package.
- The audio path supports a real DSP chain (parametric EQ, dynamics, convolution) on *all*
  targets, not just desktop.
- Offline-first: the library and queue are usable, and the app is navigable, with no network.

### Non-goals

Stated explicitly, because each of these would change the architecture if reintroduced.

- **Not a DRM client.** No Widevine/FairPlay integration. Sources that require DRM are out of
  scope; the `StreamHandle` type reserves a `drm` field so the door is not nailed shut, but
  nothing implements it.
- **Not a server.** No sync backend is built. Cross-device sync is designed as an SPI with a
  file/WebDAV reference implementation, deferred past M5.
- **No scraping of proprietary services.** The provider SPI is designed to *support* commercial
  backends, and third parties may write such plugins, but the plugins shipped in this repository
  target open protocols only: the local filesystem, Subsonic/Navidrome, Jellyfin, and plain HTTP
  URLs. This is a scoping decision as much as a legal one — open protocols have stable
  specifications to build a reference implementation against.
- **Not a general-purpose extension host.** Runtime-loaded plugins on desktop run in the same JS
  realm as the app. This is documented honestly as *defense in depth, not a sandbox*
  ([03 §7](./03-plugin-system.md#7-capability-model)).
- **No web build in scope.** React Native Web would technically work, but decision **ADR-2**
  below chooses a separate DOM UI for desktop, and a browser target would be a third shell with
  no offline story. Revisitable later; not planned.

---

## 2. Target platforms

| Target | Host | JS runtime | Kernel lives in | UI |
|---|---|---|---|---|
| iOS | Expo / React Native | Hermes | The app's single JS context | React Native |
| Android | Expo / React Native | Hermes | The app's single JS context | React Native |
| Desktop (macOS / Windows / Linux) | Electron | V8, renderer process | The **renderer** | React DOM |

Mobile requires a **custom development build** (`expo-dev-client`), not Expo Go, because
`react-native-audio-api` and several core-service modules contain native code. This is stated up
front because it affects the onboarding instructions for every contributor.

---

## 3. Architecture decisions (ADRs)

These four were settled before the design was written. Each records what was chosen, what was
rejected, and what it costs.

### ADR-1 — Plugins are statically bundled on mobile, runtime-loadable on desktop

**Decision.** A single plugin manifest format serves both targets, resolved by two different
loader plugins. On mobile, a codegen step emits static `import` statements for every plugin in
the workspace; configuration only enables, disables, and configures them. On desktop, plugins may
additionally be installed into a user directory and loaded at runtime via dynamic `import()`.

**Rejected — bundle everywhere.** Simplest, and it was the recommendation, but it makes desktop
users dependent on a project release to get any third-party source plugin. For an app whose whole
value proposition is pluggable music sources, that is the wrong tradeoff on the platform where
runtime loading is actually permitted.

**Rejected — runtime marketplace on both.** On iOS, downloading and executing new JavaScript
requires shipping an interpreter sandbox to remain store-compliant. That is a large subsystem —
sandbox, capability grants, signing, versioning — and it can be added later behind the same
manifest format without invalidating anything designed here.

**Costs.** Two loader implementations to maintain. A desktop-only install/update/quarantine flow.
A capability-grant UI. Mobile and desktop can drift in which plugins are available, so the UI must
degrade when a contributed view is absent. Desktop must load third-party code without weakening
its CSP — solved with a custom protocol, see [03 §6](./03-plugin-system.md#6-loading-two-modes).

### ADR-2 — The UI is split: React Native on mobile, React DOM on desktop

**Decision.** Two shells, two component libraries, one headless core. Plugins contribute
renderer-agnostic **descriptors** (a route, a slot filling, a command, a settings page) and ship
view implementations per target in separate packages.

**Rejected — universal React Native Web.** One UI codebase, and Electron would render the same
bundle. Cheaper by roughly half. Rejected because a desktop music player's expected interactions —
a resizable multi-column library, right-click context menus, drag-to-reorder queues, keyboard
navigation, native window chrome, a tray mini-player — are exactly the things react-native-web
makes awkward. Paying twice for the view layer buys a desktop app that feels like one.

**Costs.** Every UI-bearing plugin becomes up to three packages. Two design-token pipelines that
must be kept in sync. Two navigation systems. A discipline problem: it is now *possible* to put
logic in a view, and the architecture must actively prevent it
([08 §4](./08-ui-architecture.md#4-binding-services-to-react)).

### ADR-3 — The Electron kernel lives in the renderer; `main` is a thin native host

**Decision.** The Cordis context is created in the renderer process. The `main` process owns Node
and the OS, exposes a narrow capability-scoped surface through a `contextBridge` preload, and
contains **no business logic**. Core service plugins on desktop are thin clients over that IPC
surface.

**Rejected — split kernel (services in main, UI kernel in renderer).** Would let downloads and
playback survive the window closing. Rejected because it introduces a serialization boundary and
a remote-service proxy layer that has no counterpart on mobile, meaning the plugin graph would
differ per platform — the exact thing this architecture exists to avoid.

**Rejected — kernel in main only.** Maximum divergence from mobile; UI plugins could not share
the kernel at all.

**Consequence.** Desktop and mobile both have exactly one JS runtime hosting exactly one context.
A feature plugin cannot tell which platform it is on. The price is that desktop background work
is tied to the renderer's lifetime — mitigated by close-to-tray rather than by architecture.
See [02 §4](./02-architecture.md#4-what-background-means).

### ADR-4 — `react-native-audio-api` is the primary playback and DSP engine on every target

**Decision.** The `ctx.audio` service contract is the **Web Audio API**. On iOS and Android it is
satisfied by `react-native-audio-api`; in the Electron renderer, by the same package's web
implementation (or the browser's native Web Audio — they are the same interface).

This is the decision that makes the DSP requirement tractable. Without it, "audio effects on
mobile" means writing native DSP twice. With it, a ten-band equalizer is one `BiquadFilterNode`
cascade that runs identically on all three platforms.

**Rejected — `react-native-track-player` on mobile.** More battle-tested for background queues,
lock-screen controls, and Bluetooth/car integration. Rejected because it exposes no audio graph,
which would make EQ and effects desktop-only — abandoning a stated goal.

**Rejected — `expo-audio`.** Simplest and stays in the managed workflow, but provides neither a
queue engine nor a DSP graph.

**Costs and mitigation.** `react-native-audio-api` is at `0.13.x` — pre-1.0, with a moving API.
The mitigation is structural: `ctx.audio` is a service like any other, so an alternative engine
can be swapped behind it without touching `ctx.player` or any effect plugin. The abstraction *is*
the insurance policy. Tracked as the highest-priority item in the risk register
([10 §3](./10-roadmap.md#risk-register)).

---

## 4. Glossary

Terms used with a precise meaning throughout these documents.

| Term | Meaning |
|---|---|
| **Kernel** | `@BBeBee/kernel` — Cordis plus BBeBee's bootstrap, config loading, plugin resolution, and capability gate. Not a Cordis concept. |
| **Context** (`ctx`) | A Cordis `Context`. Simultaneously a DI container, an event bus, and a lifecycle scope. Every plugin receives its own derived context. |
| **Service** | A capability claimed on a stable context key (`ctx.fs`). Declared in `@BBeBee/protocol`, provided by exactly one plugin at a time within a given isolation scope. |
| **Fiber** | Cordis's unit of plugin lifetime. Tracks state (`PENDING` → `LOADING` → `ACTIVE` → …), holds the plugin's disposables, and reloads the plugin when its dependencies change. |
| **Effect** | A reversible side effect registered via `ctx.effect()`. The returned disposer runs automatically on unload. |
| **Core plugin** | A plugin implementing a platform service. Lives in `packages/core-*`. The only code permitted to import a platform SDK. |
| **Feature plugin** | Everything else. Reaches the platform only through service keys. |
| **Provider** | A music source implementation (`source-subsonic`). A *provider plugin* may be instantiated as several *provider instances* — two Navidrome servers are two instances of one plugin. |
| **URN** | `BBeBee:<providerInstance>:<kind>:<id>`. The stable identity of a catalog entity. |
| **Binding** | A `media_bindings` row tying a track URN to a concrete local file. What "this track is downloaded" actually means. |
| **Chain** | An ordered list of DSP effects between the player's source node and the output. |
| **Descriptor** | A renderer-agnostic UI contribution — a route, slot filling, command, or settings page — resolved to real components by whichever shell is running. |
| **Shell** | The host application that mounts the UI: `apps/mobile` or `apps/desktop/renderer`. |

---

## 5. Where to go next

[02 — Architecture](./02-architecture.md) turns these decisions into a layer diagram, a
per-platform runtime model, and a boot sequence.
