/**
 * Renderer entry.
 *
 * The shell mounts on a *service*, not a timer: `app.ready(['ui'])` resolves
 * only once the registry a shell reads from exists (docs/02 §3).
 */

import { createElement as h, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { boot } from './boot.js'
import { Shell } from './Shell.js'
import { DesktopLyricsWindow } from './DesktopLyricsWindow.js'
import { MiniPlayerWindow } from '@BBeBee/plugin-mini-player-ui-desktop'

const root = createRoot(document.getElementById('root')!)

const isMiniPlayerWindow =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('window') === 'mini-player' ||
    window.location.search.includes('mini-player') ||
    window.location.hash.includes('mini-player'))

const isLyricsWindow =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('window') === 'desktop-lyrics' ||
    window.location.search.includes('desktop-lyrics') ||
    window.location.hash.includes('desktop-lyrics'))

if (isMiniPlayerWindow) {
  document.documentElement.classList.add('is-mini-player-window')
  document.body.classList.add('is-mini-player-window')
  root.render(h(StrictMode, null, h(MiniPlayerWindow)))
} else if (isLyricsWindow) {
  document.documentElement.classList.add('is-lyrics-window')
  document.body.classList.add('is-lyrics-window')
  root.render(h(StrictMode, null, h(DesktopLyricsWindow)))
} else {
  boot()
    .then(async (app) => {
      const ctx = await app.ready(['ui'], { timeoutMs: 10_000 })
      root.render(h(StrictMode, null, h(Shell, { ctx })))
    })
  .catch((error: unknown) => {
    // A boot failure must be visible, not a blank window.
    root.render(
      h(
        'pre',
        { style: { padding: 24, color: '#FF5C5C', whiteSpace: 'pre-wrap' } },
        `BBeBee failed to start:\n\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      ),
    )
  })
}
