# BBeBee — Architecture Documentation

BBeBee is a cross-platform music player for desktop (Electron) and mobile (Expo / React Native),
built as a **plugin platform** rather than an application with an extension API bolted on. The
kernel is [Cordis](https://github.com/cordiverse/cordis) — a dependency-injection and
plugin-lifecycle framework — and *everything above the kernel is a plugin*, including file I/O,
networking, and persistence. Platform differences are absorbed by swapping which implementation
of a core service is loaded, not by branching inside feature code.

**Music sources are not plugins.** A source is a JSON document the user imports as text — the
[legado](https://github.com/gedoor/legado) book-source model applied to audio — interpreted by one
built-in runtime and sandboxed in its own JS realm. Adding a backend is a paste, not a release
([ADR-5](./01-overview.md#adr-5--music-sources-are-imported-strings-interpreted-by-one-runtime),
[06](./06-music-sources.md)).

> **Status.** M0 and M1 are built, and M2 (sources as strings) is built except where
> [10 — Roadmap](./10-roadmap.md) names open items — notably `core-js-quickjs-expo` (mobile has
> no QuickJS sandbox yet) and the `@css:`/`@xpath:` rule engines. See the roadmap's
> "Where it stands" section for the precise list. Every version number and API fact was verified
> against `pnpm-lock.yaml` at the time of writing (see
> [09 — Project Structure](./09-project-structure.md) for the pinned matrix).

---

## Getting started

```bash
pnpm install     # pnpm 11+, Node 22.12+
pnpm check       # typecheck + lint + test — green on a clean checkout
pnpm dev:desktop # Electron, with HMR across main, preload and renderer
```

`pnpm check` is the gate; if it passes, CI passes. The full command list, the plugin scaffolder,
what each gate catches, and a troubleshooting table are in
[09 §7 — Developer workflow](./09-project-structure.md#7-developer-workflow).

> Mobile needs a **custom dev build**, not Expo Go — several dependencies contain native code.
> See [09 §7](./09-project-structure.md#running-the-apps).

---

## Reading order

Read `01` and `02` first — they establish the vocabulary every other document uses.

| # | Document | What it answers |
|---|---|---|
| 01 | [Overview & Decisions](./01-overview.md) | What are we building, what are we deliberately *not* building, and which four decisions shaped everything else |
| 02 | [Architecture](./02-architecture.md) | The five numbered layers, what each may and may not depend on, the runtime model per platform, and how the app boots |
| 03 | [Plugin System](./03-plugin-system.md) | What a plugin *is*, how it declares dependencies, how it is loaded, and how it is contained |
| 04 | [Core Services](./04-core-services.md) | The platform abstraction: `fs`, `http`, `db`, `secrets`, … and their two implementations each |
| 05 | [Audio & Playback](./05-audio-playback.md) | The audio engine, the transport state machine, and the DSP effect chain |
| 06 | [Music Sources](./06-music-sources.md) | The source string: its JSON, the rule language, the runtime, trust, import, and how a broken source is repaired |
| 07 | [Data Model](./07-data-model.md) | Identity (URNs), every table, every runtime type, the event map, and migrations |
| 08 | [UI Architecture](./08-ui-architecture.md) | How one plugin contributes UI to two very different shells, tokens, and the visual design system |
| 09 | [Project Structure](./09-project-structure.md) | Monorepo layout, build pipelines, version matrix, testing strategy |
| 10 | [Roadmap & Risks](./10-roadmap.md) | Milestones with exit criteria, and what could go wrong |
| 11 | [M1 Execution Plan](./11-roadmap-M1.md) | The M1 execution plan as executed: work packages, build order, and how each M1 exit criterion was verified. Historical — the current package layout is [09](./09-project-structure.md) and the current status is [10](./10-roadmap.md) |

---

## The one-paragraph version

A Cordis `Context` is created inside the app's single JavaScript runtime — Hermes on mobile, the
Electron renderer on desktop. That context is **Layer 1**, the kernel. **Layer 2** is a small set
of **core plugins** that claim service keys (`ctx.fs`, `ctx.http`, `ctx.db`, `ctx.js`, …); they are
the *only* code in the repository allowed to import a platform SDK or to drive the kernel, and
there is one implementation per target behind each key. Above them sits **Layer 3**, three log
transports that subscribe to `ctx.logger` and decide where a line ends up; then **Layer 4** feature
plugins provide playback, DSP, downloads, the library and the sources, and **Layer 5** — the shells
and the view packages — turns those into pages. None of them may reach past Layer 2 to the
platform, or past Layer 3 to a console. All
contracts — service interfaces, entity types, and the typed event map — live in **Layer 0**, a
single runtime-free package, `@BBeBee/protocol`, which every other layer depends on and which is
the seam that makes implementations interchangeable. Features compose with each other through Cordis
**waterfall hooks**, so that, for example, the download plugin can transparently substitute a
local file for a stream URL without the player knowing downloads exist. **Music sources sit
outside all of this**: they are imported documents, held as rows, interpreted by
`plugin-source-runtime`, and presented to the rest of the app through the same provider interface
the local-files plugin implements — so nothing above `ctx.sources` can tell where a track came
from.

---

## Conventions used in these documents

- **Layer 0–5** — the six layers of [02 §1](./02-architecture.md#1-the-layer-model): protocol,
  kernel, core plugins, log transports, feature plugins, UI & business function. Written as
  "Layer 2" throughout; a package's layer is what decides which imports it may write.
- **Service key** — a name claimed on the context, e.g. `ctx.player`. Written with the `ctx.`
  prefix throughout so it is never confused with a package name.
- **Package name** — always fully qualified, e.g. `@BBeBee/plugin-download`.
- **Source** — one music backend as the user configured it, identified by its `sourceUrl` and
  addressed by a derived **source id**. A *source string* is its importable text form.
- **URN** — a stable identifier for a catalog entity, e.g.
  `BBeBee:music-example-org-35be9fe2:track:8f1a2c`. Defined in [07](./07-data-model.md).
- TypeScript blocks are **contracts**, not illustrations. They are intended to compile.
- Tables named in `snake_case` are SQLite tables. Types in `PascalCase` are TypeScript.
- ⚠️ marks a place where the two platforms genuinely differ and the abstraction leaks. These are
  called out deliberately rather than hidden.
