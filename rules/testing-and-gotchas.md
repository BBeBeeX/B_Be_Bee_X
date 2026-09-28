# Testing, Gotchas & Status

Test conventions, common gotchas, and milestone status for BBeBee.

---

## 1. Testing Strategy

| Layer | What It Covers |
|---|---|
| **Unit** | Pure logic: URN parsing, fractional indexing, transport state machine with mock audio |
| **Conformance** | Shared test suite in `packages/protocol/src/conformance/` run against all `core-*` implementations |
| **Integration** | Real Cordis context, real feature plugins, fake core services |
| **Source Corpus** | Replay fixtures in `fixtures/sources/` through `plugin-source-runtime` |
| **Leak Test** | Parameterized snapshot comparison before load and after dispose across every plugin |

### What Each Gate Catches
- `no-restricted-imports`: Reaching for platform SDKs instead of `ctx.*`
- Conformance suites: Divergence between Node and Expo implementations of core services
- Leak test: Plugins that leave event listeners, timers, or fibers behind after unload
- `conventions.test.ts`: Un-awaited `ctx.plugin()` calls or non-async `apply` functions
- `layers.test.ts`: Kernel plugin surface allowlist drift, unauthorized `createApp` calls

---

## 2. Common Gotchas

| Symptom | Cause & Solution |
|---|---|
| Metro: cannot resolve `cordis` | Missing `unstable_enablePackageExports` in `metro.config.js` |
| `@Inject` fails at runtime, compiles | Legacy decorator flags in tsconfig. Babel needs `{ version: '2023-11' }` |
| A plugin sits in `PENDING` forever | An injected service never arrived. Check `ctx.inspector` or missing service key |
| `app.start()` resolves but service not ready | Un-awaited `ctx.plugin()` in an apply function |
| `TypeError: app.inject is not a function` | `createApp()` returns `App` (`{ ctx, start, ... }`). Use `app.ctx.inject(...)` |
| `ReferenceError: process is not defined` | Vite/Electron renderer sandbox lacks Node globals. Guard with `typeof process !== 'undefined'` or use `window.BBeBee` / `ctx.device` |
| `Type '() => boolean' not assignable to Destructor` | React 19 `useEffect` cleanup requires `void`. Wrap Cordis disposers: `return () => { off() }` |
| `cannot get property "x" without inject` | Direct access to undeclared service on scoped context throws. Use `serviceOf<T>(ctx, key)` in UI components |
| Window close leaves app running in background | Secondary windows (e.g. `lyricWindow`) keep loop active when `closeToTray: false`. Call `app.quit()` explicitly on main close |
| Plugin still active after unload | Disposer returned through proxy was not wrapped in local closure |
| `CapabilityError: … may not …` | Capability missing in manifest or unauthorized namespace. Widen manifest, never the gate |
| `CapabilityError: host … not allowed` | Source rule accessed undeclared host. Add host to `allowedHosts` |
| Test fails with `Element is not defined` | Missing `// @vitest-environment jsdom` comment at the top of test file |
| `Error occurred in handler for 'BBeBee:call': EPERM ...` | Windows legacy junction points (`Documents\My Music`) have Deny Read ACLs. `FsNode.list` probes directory symlinks with `opendir` to skip unreadable ones; IPC bridge wraps calls in `BridgeEnvelope` to prevent Electron from logging unhandled rejections. |
| UI test fails asserting icon text (e.g. `textContent === '♥'`) | Desktop icons render Tabler SVG elements with `data-icon="{name}"`. Query with `container.querySelector('[data-icon="heart"]')` or `data-testid` instead of asserting against text node content. |
| `refusing to fetch bbebee-file://` or `Fetch API cannot load file://` | Electron Chromium web security restricts renderer `fetch()` on `file://` URLs. Desktop main registers privileged `bbebee-file://` scheme to stream and buffer local files. |
| `Unable to decode audio data` (24-bit FLAC / ID3v2 tags) | Chromium's Web Audio `decodeAudioData` rejects 24-bit Hi-Res FLAC or ID3v2 chunks. `core-audio-webaudio` intercepts this and falls back to `loadStreamed` via Chromium's internal FFmpeg `<audio>` element. |
| Clicking a track in Shuffle mode plays the wrong song | Shuffled order is a seeded permutation (`permute(ids, seed)`). Tapping a specific track must call `model.rotateShuffle(firstId)` to circularly rotate the permutation with the clicked track at index 0, rather than indexing into `order()[index]`. |
| Play button or surface has transparent background with CSS variable | `backgroundColor: 'var(--button-primary-bg)'` is invalid in CSS engines when the variable resolves to a `linear-gradient(...)`. CSS silently discards gradients on `backgroundColor`. Always use `background: var(...)` shorthand whenever tokens can be gradients. |
| Custom theme import crashes UI with undefined property errors | User-imported theme JSON may supply partial token trees. Always deep-merge imported tokens over `midnightPurpleTheme.tokens` before registration so all token branches (`bg`, `surface`, `brand`, `gradient`, `text`, `border`, `semantic`, `music`, `glow`) are guaranteed defined. |
| Cannot remove theme or active theme orphaned | `removeTheme(id)` must strictly protect built-in themes (`midnight-purple`, `spotify`). If the deleted theme was active, immediately fallback to default (`midnight-purple`) and emit `theme/registry-changed`. |
| Unfavouriting a track leaves the row showing a heart instead of a plus | A favourite lives in two stores — `track_stats.loved` (draws the heart) and `library_items` (drives the shelf). Every writer must write **both** (`sources.setLoved` first, then `library.setSaved`); a writer touching only one — e.g. the popover's liked toggle — leaves them disagreeing. Rows must also derive `inLibrary` from live data (`useTrackLibraryInfo`: real-time saved set + loved re-read on `library/changed`), never a hardcoded `true` or a mount-time `track.loved` snapshot, and optimistic heart state must reset when the authoritative prop changes. |
| Collapsing detail-page sticky bar scrolls away mid-scroll; virtualised rows offset by the header height | `position: sticky` only sticks within its parent's box — the bar must be the scroll container's **direct child** (the `List`'s `sticky` slot, not nested in `header`). The virtualiser also needs the header's measured height as `scrollMargin` (the kit measures it; passing rows a raw `translateY(row.start)` without subtracting it miswindows every row). |

---

## 3. Current Project Status & Known Reality

- **M0, M1, M2, M3, M4 built**:
  - Core services across desktop (Electron/Node) and mobile (Expo/RN)
  - Audio playback with Web Audio DSP chain (EQ, normalize, compressor, reverb)
  - Music sources runtime, QuickJS sandbox, rules, sources UI
  - Curation: library, playlists, downloads, cache, lyrics, desktop lyrics
  - Dynamic plugin loading with code-splitting
- **Known gaps**:
  - `core-js-quickjs-expo` not built (mobile currently has no QuickJS sandbox)
  - `@css:` and `@xpath:` rule engines are stubbed
  - Download policies do not have per-policy scopes yet
- **Differences from early docs**:
  - No Turborepo / `turbo.json`: Monorepo uses `pnpm -r`.
  - Layers 0 and 1 are single packages: `packages/protocol/` and `packages/kernel/`.
  - Versions: Node 22.12+, pnpm 11+, TypeScript 5.9.3, cordis 4.0.0-rc.9 pinned.
