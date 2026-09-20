# Visual Design Language, Tokens & Typography

> **Legacy Reference:** Formerly `docs/08-ui-architecture.md §6`.

## 6. Visual design language & design tokens

The visual design is an **immersive, dark-first streaming media aesthetic** designed to place cover
art, dense catalog lists, and high-vitality playback states at the center of the user experience.
The light theme exists as an accessible inversion, but dark is the primary mode that shapes the
entire product's surfaces and interaction model.

Tokens are **data, not components** — the only way to keep two view layers looking like one
product without sharing component code.

```ts
// @BBeBee/ui-tokens — plain values, no framework
export interface Palette {
  bg: { sunken: string; base: string; raised: string; overlay: string }
  text: { primary: string; secondary: string; disabled: string }
  accent: { base: string; hover: string; muted: string; on: string }
  state: { error: string; warn: string; ok: string }
  border: { subtle: string; strong: string }
}

export const dark: Palette = {
  bg: { sunken: '#000000', base: '#121212', raised: '#181818', overlay: '#282828' },
  text: { primary: '#FFFFFF', secondary: '#B3B3B3', disabled: '#6A6A6A' },
  accent: { base: '#1DB954', hover: '#1ED760', muted: '#1B3D2B', on: '#000000' },
  state: { error: '#F15E6C', warn: '#FFA42B', ok: '#1ED760' },
  border: { subtle: '#282828', strong: '#7A7A7A' },
}

export const light: Palette = {
  bg: { sunken: '#F1F1F1', base: '#FFFFFF', raised: '#F6F6F6', overlay: '#EDEDED' },
  text: { primary: '#000000', secondary: '#5E5E5E', disabled: '#8C8C8C' },
  accent: { base: '#12833C', hover: '#0D6E36', muted: '#D7F2E2', on: '#FFFFFF' },
  state: { error: '#C1291F', warn: '#8A5A00', ok: '#0E7A3D' },
  border: { subtle: '#E5E5E5', strong: '#767676' },
}

export const tokens = {
  space: [0, 4, 8, 12, 16, 24, 32, 48, 64] as const,
  radius: { sm: 4, md: 8, lg: 16, pill: 999 } as const,
  font: {
    family: {
      ui: '"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    size: { xs: 11, sm: 13, md: 15, lg: 20, xl: 28, display: 40 } as const,
    weight: { regular: '400', medium: '500', bold: '700', heavy: '900' } as const,
    lineHeight: { tight: 1.2, normal: 1.45, loose: 1.7 } as const,
  },
  duration: { fast: 120, normal: 200, slow: 320 } as const,
  size: { touchTarget: 44, icon: 20, iconLarge: 28, row: 56, artworkThumb: 48 } as const,
} as const
```

`ui-kit-mobile` consumes them as `StyleSheet` values; `ui-kit-desktop` emits them as CSS custom
properties (`cssVariables(scheme)`).

### 6.1 Surface hierarchy & borderless elevation

Depth is communicated through **subtle luminance stepping of near-black surfaces**, rather than
heavy borders or drop shadows. Hard outlines create visual clutter in dense catalog views; subtle
contrast steps keep surfaces distinct while making cover art pop.

| Layer | Value (Dark) | Role & Usage |
|---|---|---|
| `bg.sunken` | `#000000` | The outer chassis and persistent rails: desktop window chrome, sidebars/rails, and the bottom transport player bar. Recedes so content stands out. |
| `bg.base` | `#121212` | Main scrollable canvas: playlists, album views, search results, library grids. |
| `bg.raised` | `#181818` | Elevated media cards (album/playlist tiles) and section panels. |
| `bg.overlay` | `#282828` | Hovered rows/cards, dropdowns, context menus, tooltips, and modal sheets. |
| `border.subtle` | `#282828` | Hairline dividers between major panels (e.g. sidebar border, bottom bar border). |
| `border.strong` | `#7A7A7A` | Focused interactive boundaries and accessible outlines (clears WCAG 1.4.11 3:1). |

### 6.2 Signature accent & high-contrast rules

- **The signature accent is vibrant green (`#1DB954`, hover `#1ED760`).** It communicates action,
  vitality, and active playback: play buttons, active row titles, track progress scrubber fill,
  and active switches.
- **`accent.on` is `#000000` (black).** Light text on saturated `#1DB954` fails WCAG AA (only ~2.6:1).
  Black text and icons on green provide over 8:1 contrast. Primary circular play buttons and
  filled action pills always place black glyphs over the green fill.
- **Light mode adapts the hue to `#12833C`.** Saturated `#1DB954` on white fails contrast tests; a
  deeper forest green preserves brand recognition while remaining legible.
- **Text hierarchy**: Pure white (`#FFFFFF`, `text.primary`) carries titles and primary interactive
  labels. Muted silver-grey (`#B3B3B3`, `text.secondary`) carries artists, album titles, track
  durations, column headers, and secondary counts. Inactive controls use subdued `#6A6A6A`.

### 6.3 Typography & type scale

The typography stack prioritises geometric grotesque letterforms:
`"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
The font is resolved locally from the OS/system rather than downloaded, avoiding foreign webfont
licensing and CSP network overhead.

The scale relies on **"weight follows size"**:
- **Display (`40px`, weight `900` heavy, line-height `1.2`)**: Massive hero titles on playlist and
  album detail pages.
- **XL (`28px`, weight `900` heavy, line-height `1.2`)**: Major section headers ("Made for You",
  "Recently Played").
- **LG (`20px`, weight `700` bold)**: Section titles, shelf headers, dialog titles.
- **MD (`15px`, weight `700` bold for titles, `400` regular for body)**: Track titles, primary
  menu labels.
- **SM (`13px`, weight `400` regular)**: Artist names, album subtitle links, duration timestamps.
- **XS (`11px`, weight `500` medium / `700` bold, uppercase)**: Column labels (`TITLE`, `ALBUM`,
  `DATE ADDED`), category tags, and duration badges.

### 6.4 Component affordances & micro-interactions

- **Pill buttons (`radius.pill: 999`)**: Interactive controls (primary action buttons, category
  filter chips, tag toggles) are pill-shaped. In a borderless dark UI where panels are rectangles,
  the fully rounded shape immediately signals pressability.
- **Hover micro-scaling**: Primary pill buttons scale up slightly under the pointer
  (`transform: scale(1.04)` over `120ms`) rather than just shifting color, providing immediate,
  tactile physical feedback against near-black backgrounds.
- **Media cards & floating play reveal**: Rectangular cards (`radius.md: 8px`, `bg.raised: #181818`)
  feature square artwork (`radius.sm: 4px`) at the top, followed by bold title and artist subtitle.
  On pointer hover:
  1. The card background brightens from `#181818` to `#282828`.
  2. A vibrant green circular play button (`48px` diameter, `#1DB954` fill, `#000000` play glyph)
     rises into view at the bottom-right corner of the artwork with a gentle translateY and opacity
     transition (`120ms`) and subtle drop shadow.
  3. Clicking the play button immediately starts playback of that container without navigating.
- **Track rows (`TrackRow`, height `56px`)**:
  - Displays index number, artwork thumbnail (`48px` square, `radius.sm: 4px`), track title in
    `#FFFFFF`, artists in `#B3B3B3`, album name, and duration.
  - On hover, the row illuminates (`#282828`), the track number is replaced by a play icon (`▶`),
    and quick actions (heart/loved toggle button `♥`/`♡` via `onToggleLoved`, context menu `···`) become visible.
  - When actively playing, the track title, track number, and equalizer icon illuminate in
    signature green (`#1DB954`).
- **Scrubbers & sliders (`Slider`)**:
  - Horizontal bar (`4px` height) with a subtle grey background track.
  - Played progress fill displays in `#FFFFFF` during passive display, but illuminates in signature
    green (`#1DB954`) on pointer hover or active drag, accompanied by a circular thumb handle.

### 6.5 Dynamic hero gradients & artwork presentation

- **Square artwork (`radius.sm: 4px`)**: Tracks, albums, and playlists use square aspect ratios.
  Artists use circular avatars (`radius.pill`).
- **Zero-layout-shift loading**: Artwork containers display `blurhash` strings instantly as
  backgrounds while the full resolution image loads lazily, with fallback to `artworks.dominant_color`.
  Cover art that does not exist at all is generated instead: a deterministic identicon derived from
  the entity's URN (see the rendering rules above), so an artwork-less library still reads as a
  grid of distinct, stable squares.
- **Dynamic ambient hero banner**: Header sections of playlist and album views extract
  `artworks.dominant_color` from cover artwork, generating a rich vertical gradient that radiates
  from the top banner and smoothly bleeds down into the `#121212` base canvas.

### 6.6 Shell structure & layout paradigms

- **Desktop Shell**:
  - **Left navigation rail / sidebar (sunken `#000000`)**: Persistent navigation shortcuts (Home,
    Search, Your Library) and scrollable playlist list.
  - **Center main content card (`#121212`, rounded corners)**: Scrollable canvas hosting the
    dynamic gradient hero header, action bar (large green circular play button, heart/save, `···`),
    and virtualized track list or media card grid. The Library view organizes items through
    top-level scopes (`All`, `Local`, `Favorites`) and content views (`Tracks`, `Albums`).
  - **Persistent bottom playback bar (sunken `#000000` / `#181818`)**: Spans the entire window width.
    Left: current track artwork thumbnail, track title (`#FFFFFF`), artist subtitle (`#B3B3B3`),
    save button. Center: transport buttons (shuffle, previous, oversized circular play/pause button,
    next, repeat) and time scrubber. Right: volume slider and utility toggles (queue, lyrics,
    device picker).
- **Mobile Shell**:
  - Clean full-bleed dark views with bottom navigation tab bar (Library, Search) and scoped library
    filtering (`All` / `Local` / `Favorites`).
  - Persistent mini-player docked directly above the tab bar showing cover thumbnail, marquee title,
    artist name, play/pause toggle, and a hairline playback progress bar.
  - Full-screen now-playing sheet: Expanding the mini-player slides up an immersive player featuring
    large square cover art, bold geometric typography, scrub bar, circular transport controls, and
    swipe-up lyrics pane.

**Component parity is a contract.** Both kits export the same component names with the same props —
`Button`, `IconButton`, `TrackRow`, `Slider`, `Sheet`/`Dialog`, `List`, `EmptyState`, `Toast`,
`TextField`, `Text`, `Artwork`, `JsonTree`. A
plugin author writing both view packages should be transcribing, not redesigning. A parity test in
CI diffs the exported names and prop types of the two kits and fails on divergence, because without
it the kits drift silently and every plugin author pays.

---

