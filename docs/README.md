# BBeBee — Architecture Documentation

BBeBee is a cross-platform music player for desktop (Electron) and mobile (Expo / React Native),
built as a **plugin platform** rather than an application with an extension API bolted on. The
kernel is [Cordis](https://github.com/cordiverse/cordis) — a dependency-injection and
plugin-lifecycle framework — and *everything above the kernel is a plugin*, including file I/O,
networking, and persistence. Platform differences are absorbed by swapping which implementation
of a core service is loaded, not by branching inside feature code.

> **Status.** These documents describe a design, not a shipped system. The repository contains
> no application code yet. Every version number and API fact was verified against the published
> package at the time of writing (see [09 — Project Structure](./09-project-structure.md) for
> the pinned matrix).

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
| 02 | [Architecture](./02-architecture.md) | The layer model, the runtime model per platform, and how the app boots |
| 03 | [Plugin System](./03-plugin-system.md) | What a plugin *is*, how it declares dependencies, how it is loaded, and how it is contained |
| 04 | [Core Services](./04-core-services.md) | The platform abstraction: `fs`, `http`, `db`, `secrets`, … and their two implementations each |
| 05 | [Audio & Playback](./05-audio-playback.md) | The audio engine, the transport state machine, and the DSP effect chain |
| 06 | [Music Sources](./06-music-sources.md) | The provider SPI: search, browse, auth, stream resolution, failover |
| 07 | [Data Model](./07-data-model.md) | Identity (URNs), every table, every runtime type, the event map, and migrations |
| 08 | [UI Architecture](./08-ui-architecture.md) | How one plugin contributes UI to two very different shells |
| 09 | [Project Structure](./09-project-structure.md) | Monorepo layout, build pipelines, version matrix, testing strategy |
| 10 | [Roadmap & Risks](./10-roadmap.md) | Milestones with exit criteria, and what could go wrong |

---

## The one-paragraph version

A Cordis `Context` is created inside the app's single JavaScript runtime — Hermes on mobile, the
Electron renderer on desktop. A small set of **core plugins** claim service keys (`ctx.fs`,
`ctx.http`, `ctx.db`, …) and are the *only* code in the repository allowed to import a platform
SDK; there is one implementation per target behind each key. Above them, **feature plugins**
provide playback, music sources, DSP, downloads, the library, and the UI, and they reach the
platform exclusively through those service keys. All contracts — service interfaces, entity
types, and the typed event map — live in a single runtime-free package, `@BBeBee/protocol`, which
is the seam that makes implementations interchangeable. Features compose with each other through
Cordis **waterfall hooks**, so that, for example, the download plugin can transparently
substitute a local file for a stream URL without the player knowing downloads exist.

---

## Conventions used in these documents

- **Service key** — a name claimed on the context, e.g. `ctx.player`. Written with the `ctx.`
  prefix throughout so it is never confused with a package name.
- **Package name** — always fully qualified, e.g. `@BBeBee/plugin-download`.
- **URN** — a stable identifier for a catalog entity, e.g.
  `BBeBee:navidrome-home:track:8f1a2c`. Defined in [07](./07-data-model.md).
- TypeScript blocks are **contracts**, not illustrations. They are intended to compile.
- Tables named in `snake_case` are SQLite tables. Types in `PascalCase` are TypeScript.
- ⚠️ marks a place where the two platforms genuinely differ and the abstraction leaks. These are
  called out deliberately rather than hidden.
