# 10 — Roadmap & Risks

> **What this answers.** The order to build things in, what "done" means for each stage, and an
> honest accounting of what could go wrong.

The sequencing principle: **prove the riskiest architectural claim as early as possible.** The
claim that one plugin graph runs unmodified on Hermes and in an Electron renderer is either true
or the project needs redesigning, and it is cheap to test in week one and ruinous to discover in
month six. So M0 is deliberately unglamorous — no music plays until M1.

---

## Milestones

### M0 — The kernel runs on both platforms

Build `@BBeBee/protocol`, `@BBeBee/kernel`, and the minimum core services (`paths`, `fs`, `store`,
`db`, `logger` transports) with both implementations. Two shells that boot, load a trivial plugin,
and render its contributed view. The conformance harness and the leak test from
[09 §6](./09-project-structure.md#6-testing-strategy).

**Exit criteria**
- The same plugin package loads and activates on an iOS simulator, an Android emulator, and
  Electron, with no conditional code in the plugin.
- `pnpm test` runs the `fs`, `db`, and `store` conformance suites green against all
  implementations, on device for the Expo ones.
- Disabling a plugin restores the context snapshot exactly.
- The plugin inspector shows the fiber tree with labelled effects.

**Why first.** Every ADR is a hypothesis until this passes. If Cordis misbehaves on Hermes, or
Metro cannot resolve its `exports` map, or standard decorators do not transpile — this is where
that surfaces, while backing out is still cheap.

---

### M1 — It plays music

`core-audio-webaudio`, `plugin-player`, `plugin-source-local`, `plugin-local-scanner`, plus enough
UI in both shells to browse a library and control playback. Media session integration.

**Exit criteria**
- Scan a folder of ≥ 5,000 files; incremental rescan of an unchanged library costs stat calls only.
- Play, pause, seek, next, previous, queue reorder — on all three platforms.
- Lock-screen and notification controls work on iOS and Android; MPRIS/SMTC/Now Playing on desktop.
- Playback survives backgrounding on mobile and window-hide on desktop.
- Headphone unplug pauses ([05 §5](./05-audio-playback.md#5-interruptions-focus-and-routes)).
- Queue and position restore across a restart, without auto-playing.

---

### M2 — A second source

The provider SPI made real: `plugin-source-subsonic` with multi-instance support, auth, search,
browse, and stream resolution. `ctx.sources` aggregation and the identity-linking tables.

**Exit criteria**
- Two Navidrome instances configured simultaneously, with isolated cookie jars and independent
  auth state — cookies set by one are never sent to the other.
- **Sign in once, stay signed in.** Force-quit and relaunch: the session is restored from the
  persisted jar with no prompt and no stored password
  ([06 §4.1](./06-music-sources.md#41-session-persistence--cookies-survive-the-app)).
- **Sign out leaves nothing.** After `signOut()`, the jar's persisted copy and the secrets
  namespace are both gone; relaunching shows a signed-out source.
- A provider implementing only the required core (`plugin-source-http-url`) is configured
  alongside the others without any screen breaking on a missing optional method.
- `searchAll` returns per-provider results and reports a failing provider without failing the
  search.
- Token expiry mid-session refreshes transparently; a failed refresh shows an in-place re-login
  and leaves cached content browsable.
- The full error taxonomy is exercised — every row in
  [06 §6](./06-music-sources.md#6-errors) has a test.
- A local track and a server track of the same recording are linked by ISRC and shown as one
  library item with two sources.

**Why second.** One provider proves nothing about an SPI. The second is where the abstraction is
either validated or exposed as a description of the first implementation.

---

### M3 — Offline

`plugin-download` with a resumable task queue, `media_bindings`, download policies, and the
`player/before-resolve` substitution.

**Exit criteria**
- Kill the app mid-download; on relaunch it resumes from `bytes_done`, and a changed `etag`
  restarts cleanly rather than splicing corrupt bytes.
- With `plugin-download` disabled, the same track streams and playback behaves identically —
  the test in [09 §6](./09-project-structure.md#6-testing-strategy).
- Policies honour `wifi_only` and `charging_only` against real `ctx.device.network()` transitions.
- Deleting the underlying file removes the binding rather than failing at play time.
- Cache eviction stays within per-class quotas under sustained use.

---

### M4 — It sounds good

`plugin-dsp` and the built-in effects from
[05 §3](./05-audio-playback.md#built-in-effects). Chain editor UI in both shells.

**Exit criteria**
- EQ, normalize, compressor, and reverb run on iOS, Android, and desktop from one implementation
  each.
- Every effect's offline-render test matches its reference within tolerance.
- Dragging an EQ slider does not rebuild the graph and produces no clicks.
- Enabling or reordering an effect mid-playback is inaudible apart from the intended change.
- `tempo-pitch` reports dropouts and self-disables on a low-end Android device rather than
  degrading the whole chain.

**Why this late.** It is the most visible feature and the least architecturally risky — the
Web Audio contract from M1 either supports it or does not, and by M4 that is already known.

---

### M5 — Third-party plugins on desktop

`plugin-loader-dynamic`, the `BBeBee-plugin://` protocol, install/update/uninstall, capability
grants, and quarantine.

**Exit criteria**
- A plugin built outside the repo installs from a local file and a URL, and loads under the strict
  CSP with `nodeIntegration` off.
- A plugin requesting a capability it was not granted receives a `CapabilityError`, and the
  operation fails cleanly rather than crashing the app.
- A plugin that throws on load twice is quarantined; the app boots normally afterwards and shows
  why.
- Uninstalling disposes the fiber before removing files, and "remove data" drops exactly that
  plugin's namespaced tables.

---

### Beyond M5

Not scheduled, but designed for and not blocked by anything above:

- **Sync** — a `SyncProvider` SPI with a file/WebDAV reference implementation. The schema already
  carries `device_id`, `revision`, and `sync_state`.
- **A real sandbox** — a `Worker` or QuickJS realm for third-party plugins, with the capability
  grammar from [03 §7](./03-plugin-system.md#7-capability-model) becoming the bridge protocol.
- **Mobile runtime plugins** — unblocked once the sandbox exists.
- **Fingerprint matching** — an AcoustID plugin feeding `track_links`.
- **More providers** — Jellyfin, podcast feeds, whatever the SPI turns out to accommodate.

---

## Risk register

Ordered by expected cost, not likelihood.

### 🔴 Cordis is a release candidate

Its README says the API may change without notice, and it is the foundation of everything.

*Mitigation* — exact pinning, a deliberately narrow API surface, plugins importing from
`@BBeBee/kernel` rather than `cordis` so one adapter absorbs a signature change, and semantic
tests that fail loudly on an upgrade
([09 §5.1](./09-project-structure.md#51-the-cordis-rc-problem)).

*Trigger to reconsider* — if an RC bump breaks the isolation or effect semantics the design
depends on, the fallback is vendoring the pinned version. Cordis's core is a few thousand lines
with two dependencies, which makes that a real option rather than a theoretical one.

### 🔴 `react-native-audio-api` is pre-1.0

ADR-4 buys the entire cross-platform DSP story from a `0.13.x` package.

*Mitigation* — the contract is the **standard Web Audio API**, not the library's own shape, so the
switching cost is bounded. `core-audio-rntp` over `react-native-track-player` is the documented
fallback, at the price of mobile DSP.

*Early warning* — M1 exercises streaming, gapless, and lock-screen controls. If it disappoints
there, the decision can be revisited before M4 depends on it.

### 🟠 The abstraction leaks faster than it is patched

Two implementations of `ctx.fs` drift; a feature plugin quietly starts depending on desktop
behaviour; six months later "it works on my machine" means "it works on desktop".

*Mitigation* — the conformance suites are the primary defence and must run on real devices in CI,
not only in Node. The ESLint import ban ([09 §3](./09-project-structure.md#3-dependency-rules))
catches the crude version. The known leaks are documented with ⚠️ rather than hidden, so a
contributor meets them before their code does.

### 🟠 The split UI doubles more than the view layer

ADR-2 accepts writing views twice. The failure mode is logic creeping into views, at which point
it is written twice too, and the two shells begin to *behave* differently.

*Mitigation* — the three-package convention with hooks in the headless package
([08 §4](./08-ui-architecture.md#4-binding-services-to-react)), and the component-parity test in
CI. If desktop and mobile ever disagree about what a button does, that is a bug in the headless
package by definition.

### 🟠 iOS background limits

Non-audio background work is unreliable by design, and no architecture fixes it.

*Mitigation* — the constraint is in the contract: `ctx.background.canRunInBackground()` exists so
plugins ask, and `download_tasks` checkpoints per chunk so interruption is cheap. The UI tells the
truth about what will and will not continue, rather than showing a progress bar that silently
stalls.

### 🟡 Third-party plugins are not contained

Runtime-loaded plugins share the renderer's realm. The capability model is defense in depth, not a
sandbox, and [03 §7](./03-plugin-system.md#what-this-is-not) says so plainly.

*Mitigation until a real sandbox exists* — install-time capability prompts naming what is being
granted, integrity hashes, quarantine after repeated failure, and an install warning that does not
soften the situation. The design does not depend on containment being solved; adding it later
changes the bridge, not the plugin contract.

### 🟡 Version drift across two large frameworks

Expo SDK bumps move React Native and React together; Electron bumps move Node and V8. They will
not stay aligned on React versions on their own.

*Mitigation* — React and React Native are pinned to what Expo SDK 57 dictates, and the desktop
renderer follows Expo's React, not the newest release
([09 §5](./09-project-structure.md#5-version-matrix)). Upgrades are a scheduled task with the
conformance suite as the gate. Choosing `node:sqlite` over `better-sqlite3` already removed the
worst recurring cost.

### 🟡 SQLite as the single store

One database holds catalogue, playlists, history, downloads, settings, and plugin tables. On a
large library with an aggressive scanner and a busy download queue, write contention is plausible.

*Mitigation* — WAL, batched writes in the scanner, and a single serialised writer path on both
platforms. If it becomes a problem, splitting the volatile tables (`play_history`,
`cache_entries`, `download_tasks`) into a second database file is a contained change, because
nothing joins across those boundaries.

---

## What would make this design wrong

Worth writing down so it is recognisable:

- **If only one music source ever ships**, the provider SPI is overhead and a direct implementation
  would have been better. M2 is the test.
- **If plugins are never loaded at runtime**, ADR-1's desktop loader, the capability model, and the
  manifest are all cost with no return, and static bundling everywhere was correct.
- **If mobile and desktop end up with substantially different feature sets**, the split UI has
  become a split *product*, and the universal RN-Web option that ADR-2 rejected was the right call.

None of these are visible yet. All three are checkable by M5.
