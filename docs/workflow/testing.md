# Testing Strategy, Conformance & Developer Workflow

> **Legacy Reference:** Formerly `docs/09-project-structure.md §6 – §8`.

## 6. Testing strategy

Four layers, each catching something the others cannot.

| Layer | Tool | What it covers |
|---|---|---|
| **Unit** | Vitest | Pure logic: URN parsing, fractional indexing, smart-playlist compilation, the transport state machine against a mock `AudioService` |
| **Conformance** | Vitest (Node) + Detox (device) | Every `core-*` implementation against the shared suite in `@BBeBee/protocol/conformance` (04 §18). **The most important layer** |
| **Integration** | Vitest with an in-memory context | A real Cordis context, real feature plugins, fake core services. Covers plugin load order, waterfall composition, and unload completeness |
| **Source corpus** | Vitest, responses recorded inline in the tests | Every example document in `fixtures/sources/` replayed end to end — search, explore, album, stream — so a rule-engine change that breaks real documents fails CI. `pnpm source:record` (to move these to fixture files) is planned, not built |
| **Device smoke** | Manual, per release | Lock screen, Bluetooth, headphone unplug, incoming call, gapless boundary, background survival (05 §7) |

Two tests that are worth writing before almost anything else, because they encode the
architecture's central claims:

```ts
// Claim: unload is total. (03 §2)
it('leaves nothing behind when disabled', async () => {
  const before = snapshotContext(ctx)         // listeners, timers, services, effects
  const fiber = await ctx.plugin(SomePlugin, config)
  await fiber.dispose()
  expect(snapshotContext(ctx)).toEqual(before)
})

// Claim: the player does not know downloads or caches exist. (02 §5, 05 §2)
it('plays the same track with and without plugin-download', async () => {
  const withoutDl = await resolveVia(ctxWithout, urn)
  const withDl    = await resolveVia(ctxWith, urn)
  expect(withoutDl.kind).toBe('remote')
  expect(withDl.kind).toBe('local')
  expect(playerBehaviour(withoutDl)).toEqual(playerBehaviour(withDl))
})
```

The first is run parameterised over **every** plugin in the workspace. A plugin that leaks fails CI.

A third belongs beside them once sources exist, because it is the claim the whole string model
rests on:

```ts
// Claim: a source is data, and the runtime is the only interpreter. (06 §1.1)
it('plays from a document nobody compiled', async () => {
  await ctx.sources.import(await readFixture('subsonic.json'))
  const hit = await ctx.sources.searchAll({ text: 'radiohead' })
  const handle = await ctx.sources.forUrn(firstUrn(hit))!.resolveStream(id, prefs)
  expect(handle.target).toMatch(/^https:\/\/music\.example\.org\/rest\/stream/)
})
```

The corpus suite is the one that decays without attention: recorded fixtures drift from live
backends, and a green corpus with a broken real source is the failure mode to watch for. The
`check` command ([06 §10](../sources/authoring.md#10-diagnosing-a-broken-source)) run against live
servers, by hand, per release, is the counterweight — the same shape as the device smoke matrix,
and honestly manual for the same reason.

---

## 7. Developer workflow

### First run

```bash
pnpm install                 # pnpm 11+, Node 22.12+
pnpm check                   # typecheck + lint + test — should be green on a clean checkout
```

`pnpm check` is the whole gate. If it passes, CI passes. Run it before pushing; nothing else in
this section is required reading until something goes wrong.

### Everyday commands

| Command | What it does |
|---|---|
| `pnpm check` | `typecheck` + `lint` + `test`. The one command before a PR |
| `pnpm check:changed` | `typecheck` + `lint` + `test` on packages and files in the current diff |
| `pnpm test` | Vitest once over every package |
| `pnpm test:watch` | Vitest in watch mode — what to leave running while working |
| `pnpm typecheck` | `tsc --noEmit` in every package **and** both apps |
| `pnpm lint` / `pnpm lint:fix` | ESLint, including the architectural rules in [§3](#3-dependency-rules) |
| `pnpm build` | Emit `dist/` for every package |
| `pnpm clean` | Remove `dist/`, `out/`, and build info |

Run a single package's tests by path — `pnpm test packages/core/core-fs-node` — or a single file.

### Running the apps

| Command | What it does | What it needs |
|---|---|---|
| `pnpm dev:desktop` | `electron-vite dev` — HMR across main, preload and renderer | The Electron binary (fetched by `pnpm install`; needs network on first install) |
| `pnpm build:desktop` | Production bundles into `apps/desktop/out/` | — |
| `pnpm dev:mobile` | `expo start --dev-client` | A **custom dev build** on a device or emulator — see below |

> ⚠️ **Mobile needs a custom dev build, not Expo Go.** `react-native-audio-api`, `expo-sqlite` and
> `expo-file-system` all contain native code, so Expo Go cannot host this app. Build the dev client
> once per native-dependency change (`pnpm --filter @BBeBee/mobile exec expo run:android`), then
> `pnpm dev:mobile` attaches to it.

> ⚠️ **Packaging is not set up yet.** `build:desktop` produces bundles, not an installer;
> `electron-builder` (dmg / nsis / AppImage) and `eas build` for mobile arrive with the first
> release, not M0.

### Adding a plugin

```bash
pnpm new:plugin --name scrobble --kind feature --ui desktop --capabilities db:own
pnpm install                 # link the new workspace package
pnpm gen:plugins             # add it to both shells' static registries
pnpm check                   # already green — the template ships passing tests
```

| Flag | Values | Effect |
|---|---|---|
| `--name` | lowercase, hyphenated | `scrobble` → `@BBeBee/plugin-scrobble` |
| `--kind` | `feature` (default), `effect` | Sets the package prefix. There is no `source` kind: a music backend is a document, not a package |
| `--ui` | `none` (default), `desktop`, `mobile`, `both` | Emits the per-target view packages of [08 §1](../ui/architecture.md#1-the-three-package-convention) |

The headless package lands in `packages/feature/`, its views in `packages/ui/`
([§1](#1-repository-layout)). That placement is the scaffolder's most consequential output: the
lint rules key off the layer directory, so a package written into the wrong one is silently
governed by the wrong rules. `tooling-create-plugin`'s own test asserts the split.
| `--capabilities` | comma-separated | Written into `BBeBee.plugin.json` ([03 §7](../plugins/capabilities.md#7-capability-model)) |

The scaffolder is not a nicety. With a three-package convention, a manifest format, a capability
list, and a leak test to wire up, hand-rolling a plugin means getting one of them wrong — usually
the one that fails *silently*. The template ships the correct `await ctx.plugin(...)` form and a
leak test, both of which cost a debugging session to discover the hard way.

### Adding & authoring music sources

- **End users**: not a development task at all. In the app: **Settings → Sources → Import**, paste the string, review what it says it will do, confirm ([06 §9](../sources/authoring.md#9-importing-updating-and-sharing)). No install, no rebuild, no restart.
- **Source authors & developers**:
  To avoid writing hundreds of lines of escaped JavaScript inside a single JSON string, author sources in the `sources/<id>/` directory:
  - `source.json`: metadata, allowed hosts, and declarative rule blocks.
  - `source.js`: unescaped JavaScript logic with full IDE syntax highlighting, ESLint, and autocomplete.

| Command | What it does |
|---|---|
| `pnpm build:sources` | Validates and compiles all `sources/` into self-contained single-file documents in `fixtures/sources/<id>.json` |
| `pnpm watch:sources` | Watches `sources/` and recompiles automatically on change |
| `node --experimental-strip-types scripts/sources/cli.ts --unpack <file> [dest]` | Unpacks any existing single-file JSON back into `source.json` + `source.js` dual-file format |

Two commands are **planned** (M2 cleanup; for online backend testing) for working on the *documents this repository ships* in `fixtures/sources/`:

| Command (planned) | What it will do |
|---|---|
| `pnpm source:check <file>` | Run [06 §10](../sources/authoring.md#10-diagnosing-a-broken-source)'s health check against the live backend and print the trace. Needs network and, for anything authenticated, credentials in the environment |
| `pnpm source:record <file>` | Replay the same steps and write the HTTP fixtures the corpus suite ([§6](#6-testing-strategy)) replays offline |

**After adding or removing a plugin, run `pnpm gen:plugins`.** Metro cannot resolve a runtime path,
so both shells read a generated registry of static imports ([§4](#4-build-pipelines)). The output
is committed; CI checks it is current rather than regenerating it.

### What each gate actually catches

Worth knowing, because a failure in one of these usually means an architectural mistake rather
than a typo:

| Gate | Catches |
|---|---|
| `no-restricted-imports` | A plugin reaching for a platform SDK instead of a `ctx.*` service ([02 §1](../architecture/layers.md#the-invariant)) |
| Conformance suites | Two implementations of one service drifting apart — the thing they exist for |
| `*-scope` suites | A capability gate that holds on one platform and not the other |
| Leak test (`diffSnapshots`) | A plugin that does not unload cleanly ([§6](#6-testing-strategy)) |
| `conventions.test.ts` | An un-awaited `ctx.plugin()`, which silently fails to propagate readiness |

### When something goes wrong

| Symptom | Cause |
|---|---|
| Metro: *cannot resolve `cordis`* | `unstable_enablePackageExports` missing from `metro.config.js` — Cordis is ESM-only with an `exports` map ([04 §17](../services/contracts.md#17-runtime-compatibility-checklist)) |
| `@Inject` fails at runtime, compiles fine | Legacy decorators. Babel needs `{ version: '2023-11' }`; `tsconfig` must not set `experimentalDecorators` |
| A plugin sits in `pending` forever | An injected service never became ACTIVE. `ctx.inspector.render()` prints the tree and names what each fiber waits for |
| `app.start()` resolves but a service is not ready | An un-awaited `ctx.plugin()` somewhere. `pnpm test packages/kernel` will name the file |
| `CapabilityError: … may not …` | The manifest is missing a capability, or the path/table is genuinely out of scope. Widen the manifest, never the gate |
| `CapabilityError: host … not allowed` from a source | The document's rules reach a host it did not declare. Add it to `allowedHosts` and re-import, so the user sees it (06 §8) |
| A source returns nothing, with no error | A rule matched nothing where the field was optional. The test screen shows what the backend actually answered (06 §10); `check` finds it before a user does |
| `JsTimeoutError` in a source | An `@js:` block looped, or awaited a request that never resolved. Limits are per evaluation and not configurable per source (04 §19) |
| Renderer: *preload bridge is missing* | The renderer loaded without `preload/index.cjs` — rebuild, since preload must be CJS |
| Electron will not launch on a headless machine | Expected. It needs `libgtk-3`, `libnss3` and a display; the bundles still build |

### Local checklist before opening a PR

- [ ] `pnpm check` clean.
- [ ] `pnpm gen:plugins` produces no diff.
- [ ] New plugin passes the leak test in [§6](#6-testing-strategy).
- [ ] New core service implementation passes its conformance suite — **and its `*-scope` suite, on
      every implementation of that service**, not only the one you changed.
- [ ] No new import that the [§3](#3-dependency-rules) rules would have to be widened to permit.
- [ ] Version matrix updated if a dependency moved.
- [ ] If the rule engine changed, the source corpus ([§6](#6-testing-strategy)) is green — and if
      a fixture had to be re-recorded, say why in the PR, because a silently re-recorded fixture
      hides a real behaviour change.

---

## 8. Where to go next

[10 — Roadmap & Risks](../roadmap/roadmap.md) sequences the build.
