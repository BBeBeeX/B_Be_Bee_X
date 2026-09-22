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
