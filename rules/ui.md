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
- Sliders: subtle grey track, filled with green (`#1DB954`), circular thumb.

### Artwork & Fallback
- Artwork renders `blurhash` first, then falls back to `artworks.dominant_color`.
- If no cover exists, generate a GitHub-style square identicon from entity URN (`identicon()` in `ui-core`).
- Cache integration: Covers resolve through `ctx.cache` (`useResolvedArtwork` in `@BBeBee/plugin-cache/hooks`).
