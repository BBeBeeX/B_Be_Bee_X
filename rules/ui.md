# UI Architecture & Design Rules

Rules for writing views, design tokens, hooks, and descriptors in BBeBee.

---

## 1. The Three-Package Convention

Any UI-bearing feature is split into up to three packages:

```
packages/feature/plugin-library/            ← headless (L4): state, services, hooks, logic
packages/ui/plugin-library-ui-mobile/       ← React Native views (L5)
packages/ui/plugin-library-ui-desktop/      ← React DOM views (L5)
```

> **A UI package contains no business logic that would need to be written twice.**
> If an `if` branch would exist identically in both UI packages, it belongs in the headless package.

View packages import from headless packages through **public subpaths only**:
- Types and models
- Shared custom hooks (`@BBeBee/plugin-library/hooks`)
- Descriptor view IDs (`@BBeBee/plugin-library/views`)
- Never deep-import into `src/*` of another package.

---

## 2. Descriptors, Not Components

Plugins never pass React components directly to the shell or core services.
Instead, they register serializable **descriptors** (`route`, `slot`, `command`, `settings`, `menu`):
```ts
ctx.ui.registerSlot('now-playing.actions', {
  id: 'library.like-button',
  viewId: 'plugin-library:like-button',
})
```
Each shell resolves the `viewId` against its target registry via `ctx.ui.registerView(viewId, Component)`.

> ⚠️ **Always register a component bound to your plugin context**:
> The shell context only has `ctx.ui`. Reaching for `ctx.player` from the shell context throws.
> Each view package binds to its own context: `bound(ctx, ScreenComponent)`.

---

## 3. Hooks & State Binding

- `@BBeBee/ui-core` provides `useService` and `useServiceState(key, events, select)` backed by `useSyncExternalStore`.
- No `useEffect` for domain mutations (call service methods directly).
- Optimistic updates must reside in the service, not in React component state.
- Lists must be virtualized:
  - Mobile: `@shopify/flash-list` (`FlashList`)
  - Desktop: `@tanstack/react-virtual`

---

## 4. Visual Design Language & Style Guide

The visual presentation is an **immersive, dark-first streaming media aesthetic**:

### Surface Hierarchy (Luminance stepping, not borders)
- `bg.sunken` (`#000000`): Outer chassis, desktop sidebar rail, persistent bottom player bar.
- `bg.base` (`#121212`): Main content canvas and scrollable lists.
- `bg.raised` (`#181818`): Media cards (album/playlist tiles) and elevated panels.
- `bg.overlay` (`#282828`): Modal dialogs, context menus, tooltips, hover states.
- `border.subtle` (`#282828`): Dividers.
- `border.strong` (`#7A7A7A`): Accessible focus outlines.

### Signature Accent & Contrast
- `accent.base` (`#1DB954`): High-vitality green for play buttons, active row titles, track scrubber fill.
- `accent.on` is **black (`#000000`)**: Text or icons rendered on top of green fills MUST be black (WCAG AA >8:1 contrast). **Never place white text on green.**
- Text hierarchy: `#FFFFFF` (`text.primary`) for titles and active items; `#B3B3B3` (`text.secondary`) for secondary text; `#6A6A6A` (`text.disabled`).

### Typography (Geometric Grotesque)
- Stack: `"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, Roboto, sans-serif`.
- Heavy/Bold (`900`/`700`) for headers, Medium (`500`) for track titles, Regular (`400`) for secondary metadata.

### Controls & Micro-interactions
- Controls are **pill-shaped (`radius.pill: 999`)**; buttons grow slightly on hover (`scale(1.04)` over 120ms).
- Track rows: 56px height, show play toggle on hover, active playing track glows green (`#1DB954`) with an equalizer icon.
- Sliders: slim 3px track height, subtle dark track, filled with green (`#1DB954`). Circular thumb handle is hidden on idle (`opacity: 0`) and smoothly reveals on hover or active dragging (`opacity: 1`).
- Scrollbars: 4px width/height, transparent track background, high-transparency thumb (`rgba(255, 255, 255, 0.2)` default, `0.4` on hover).
- TopBar Search & 2×2 Matrix:
  - Centered input in TopBar with dynamic icon transition (idle: left `12px`; active/focused: slides to far right `12px` as a clickable submit button; resets on outside-click or Escape).
  - 2×2 Matrix floating dropdown reveals below input:
    - Row 1: "搜索范围" (`Search Scope`) | "搜索历史" (`Search History`) + high-transparency "清空" (`Clear`) button.
    - Row 2: Third-party music source toggle buttons (via `useSearchSourceSelection(ctx)` with all/none toggles) | Search history tags (saved in `localStorage`, click to execute).
  - Enter, clicking the right search icon, or selecting a history tag commits to history and routes to `sources.search` with `{ query }`. `SearchScreen` automatically runs `searchAll(query)`.
- Sidebar & Navigation Exclusions:
  - Left navigation rail strictly hosts content and library browsing (`library.view`, `history.view`, playlists).
  - `settings.view` and `sources.search` are explicitly excluded from sidebar rendering. Settings is opened via the TopBar user avatar; Search is driven by the TopBar search bar.
- Bottom player bar: Center cluster order is `[PlayMode] [Previous] [Play/Pause] [Next] [Volume]`. Play mode cycles sequence/single-loop/list-loop/shuffle. Volume icon indicates sound state (muted 'x' or loudness waves) and clicks to pop up a vertical volume bar with a bottom mute toggle.

### Artwork & Fallback
- Artwork renders `blurhash` first, then falls back to `artworks.dominant_color`.
- If no cover exists, generate a GitHub-style square identicon from entity URN (`identicon()` in `ui-core`).
- Cache integration: Covers resolve through `ctx.cache` (`useResolvedArtwork` in `@BBeBee/plugin-cache/hooks`).

---

## 5. Desktop Settings Center & Diagnostics Specifications

### Layout & Navigation Principles
- **Single-page vertical scrolling**: All setting categories reside simultaneously in the DOM tree, browsed via natural window scrolling. Avoid nested scroll containers inside sections.
- **Text-only tab bar**: Header tab bar contains pure text labels (no icons), providing smooth anchor jumping via `scrollIntoView({ behavior: 'smooth' })`.
- **Card-level hierarchy**: Use muted translucent backgrounds (`rgba(255, 255, 255, 0.03)`) for section cards with generous whitespace, rather than wrapping individual setting rows into isolated cards.
- **Consistent row components**:
  - `Boolean` → `Switch`
  - `Enum` → `Select` dropdown
  - `Number` → `Slider`
  - `Text` → `Input`
  - `Action` → `Button`
  - `Nested/Expanded` → Chevron expandable row

### Dedicated Domains in Settings
- **General & Language**: Language selector; minimize to system tray on window close (`closeToTray`). (Theme selection is omitted on desktop to preserve the immersive dark streaming look).
- **Playback & Audio**: Crossfade, gapless playback, pause on unplug, and an action button to open the dedicated DSP Equalizer view (`dsp.view`).
- **Desktop Lyrics**: Master enable switch, position persistence (`{ x, y }`), locked click-through toggle, single/double line mode, left/center/right alignment, custom font family and size (16–48px), color palette with hex input, opacity (0.2–1.0), live floating preview card, and strict 4-step startup lifecycle (1. check enabled → 2. restore position → 3. push settings & data → 4. show window).
- **Global Hotkeys**: Master toggle (enabled by default) and 10 standard media/navigation bindings (`togglePlay`, `prev`, `next`, `volumeUp`, `volumeDown`, `seekForward`, `seekBackward`, `toggleLyrics`, `toggleApp`, `favorite`), backed by `ctx.device.registerHotkey`.
- **Network & Proxy**: Master toggle, protocol (HTTP/HTTPS/SOCKS5), host/port, latency probe button targeting Google (`https://www.google.com/generate_204`), and per-source proxy bypass switches embedded directly within the proxy card.
- **Storage & Cache**: Download and Cache directories with path badges, native folder picker (`dialog.pickDirectory`), and directory opener (`shell.openPath`).
- **About & Advanced Settings (Diagnostics Guard)**: App metadata, followed by an "Advanced Settings" ("高级设置") expandable toggle button that houses Developer Diagnostics (`debug.view`, `debug.logs`, `debug.http-logs`) and the Danger Zone (settings reset), keeping primary settings clean.

### Diagnostics System
- `debug.view`: Debug mode indicator, environment specs (Node, Electron, OS, Chromium, paths), and quick links to log screens.
- `debug.logs`: Discover live ring-buffer logs (`ctx.logBuffer`) with level filters, search, and NDJSON export.
- `debug.http-logs`: Outgoing HTTP requests from third-party music sources, detailing method, status code, latency, and URL.

---

## 6. Library Sidebars & Context Menus Specification

### Library Layout Modes
- **Collapsed Mode (72px)**: Minimal compact rail showing icon tiles. Folders render dedicated folder outline SVG icons. Entering a folder reveals a `<` return button beneath the top logo to return to the root library.
- **Sidebar Mode (260–340px)**: Standard library navigation. Folders feature inline expand/collapse via rotating triangle arrows (`▼` / `▲`), indenting children by 28px left padding. Clicking the folder row navigates into the folder details screen (`< 文件夹名称`).
- **Expanded Mode (Full Canvas)**: High-density 3-column table view with breadcrumbs (`音乐库 < 文件夹名称`), interactive search, and responsive sizing.

### Context Menu Design Standards
- **Dark Card Theme**: `#242424` background, 8px border radius, 4px padding, `0 12px 32px rgba(0,0,0,0.55)` depth shadow, and 1px border (`rgba(255, 255, 255, 0.08)`).
- **Dividers**: Menu items support `divider: true` to render a 1px translucent separator line (`rgba(255, 255, 255, 0.08)`).
- **Outline Icons**: Standard actions map to high-precision SVG outlines: `pencil`, `delete`, `pin`, `create-playlist`, `create-folder`, `folder`, `play`, `download`, `playlist-add`.
- **Submenu Trigger**: Small solid triangle (`▶`).
- **Recursive Track Gathering**: When adding a folder's contents to other playlists ("添加至其他歌单"), the system uses `collectAllFolderTracks` to recursively scan all direct tracks, nested playlist tracks, nested album tracks, and all descendant subfolders without duplicates.
- **Dedicated Modals**:
  - `EditPlaylistModal`: Modify cover art (file picker or URL), title, and multiline description.
  - `RenameFolderModal`: Rename folder title and save via `ctx.library.renameCollection`.

