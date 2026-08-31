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

const root = createRoot(document.getElementById('root')!)

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
