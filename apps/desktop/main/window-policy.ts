/**
 * When a window close hides, and when it destroys.
 *
 * Separated from `index.ts` so it can be *checked*. M1's exit criterion 4 asks
 * for "an automated check that closing hides rather than destroys", and
 * `index.ts` imports Electron at module scope, so nothing in it can be loaded
 * outside a real main process. This file imports nothing: the decision is a
 * function of three facts, and the handler in `index.ts` supplies them.
 *
 * Still no business logic in `main` (docs/02 §2) — this is a window policy,
 * which is exactly what this process is for.
 */

/** What the close handler knows when it has to decide. */
export interface CloseContext {
  /** The user asked to quit — tray menu, app menu, or `before-quit`. */
  quitting: boolean
  /** A tray icon exists, so a hidden window can be got back. */
  hasTray: boolean
  /** `process.platform`. macOS keeps an app alive with no windows by design. */
  platform: NodeJS.Platform
  /** User preference: whether closing the window should minimize/hide to tray. Default true. */
  closeToTray?: boolean
}

/**
 * Whether hiding the last window leaves a way back to it.
 *
 * ⚠️ The reason this is a question at all: a Linux session with no
 * StatusNotifier host has no tray, and hiding the last window there leaves a
 * process with no window, no tray and no dock — running, playing, and
 * impossible to reach or quit except from a terminal. Losing playback on close
 * is worse than the alternative everywhere the tray exists, and much better
 * than that.
 */
export function canSurviveWithoutWindow(ctx: Omit<CloseContext, 'quitting'>): boolean {
  return ctx.hasTray || ctx.platform === 'darwin'
}

/**
 * `true` when the close must be intercepted and the window hidden instead.
 *
 * This is MD-6: keeping the renderer alive keeps the kernel, the queue and the
 * audio graph alive, so "close the window" and "stop the music" stop being the
 * same gesture.
 */
export function shouldHideOnClose(ctx: CloseContext): boolean {
  if (ctx.quitting) return false
  if (ctx.closeToTray === false) return false
  return canSurviveWithoutWindow(ctx)
}

/**
 * `true` when the last window going away should end the process.
 *
 * Reached only when a window was genuinely destroyed, since `shouldHideOnClose`
 * intercepts the rest.
 */
export function shouldQuitWhenWindowsGone(ctx: CloseContext): boolean {
  return ctx.quitting || ctx.closeToTray === false || !canSurviveWithoutWindow(ctx)
}
