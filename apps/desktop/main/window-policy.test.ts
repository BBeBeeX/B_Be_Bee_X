/**
 * MD-6, as a check rather than an intention.
 *
 * M1's exit criterion 4 asks for "an automated check that closing hides rather
 * than destroys". This is that check. The other half of the criterion — the
 * wake lock held while playing — lives in `plugin-player`'s suite, where the
 * transport that takes it is.
 *
 * What cannot be checked here is that Electron honours `preventDefault`, which
 * is Electron's job and the smoke matrix's.
 */

import { describe, expect, it } from 'vitest'
import { canSurviveWithoutWindow, shouldHideOnClose, shouldQuitWhenWindowsGone } from './window-policy.js'

const WITH_TRAY = { hasTray: true, platform: 'win32' as NodeJS.Platform }
const NO_TRAY = { hasTray: false, platform: 'linux' as NodeJS.Platform }
const MAC = { hasTray: false, platform: 'darwin' as NodeJS.Platform }

describe('closing the window', () => {
  it('hides rather than destroys, so playback survives it', () => {
    // The exit criterion. Destroying the window destroys the renderer, and
    // with it the kernel, the queue and the audio graph — "close the window"
    // and "stop the music" would be the same gesture.
    expect(shouldHideOnClose({ ...WITH_TRAY, quitting: false })).toBe(true)
    expect(shouldQuitWhenWindowsGone({ ...WITH_TRAY, quitting: false })).toBe(false)
  })

  it('keeps the app alive on macOS with no tray, where the dock is the way back', () => {
    expect(shouldHideOnClose({ ...MAC, quitting: false })).toBe(true)
  })

  it('lets the close through where there would be no way back', () => {
    // A Linux session with no StatusNotifier host has no tray. Hiding the last
    // window there leaves a process with no window, no tray and no dock:
    // running, playing, and unreachable except from a terminal. Losing
    // playback is the better of the two.
    expect(shouldHideOnClose({ ...NO_TRAY, quitting: false })).toBe(false)
    expect(shouldQuitWhenWindowsGone({ ...NO_TRAY, quitting: false })).toBe(true)
  })

  it('does not intercept a close that is a quit', () => {
    // Otherwise the tray's own "Quit" hides the window and the app never ends.
    for (const target of [WITH_TRAY, MAC, NO_TRAY]) {
      expect(shouldHideOnClose({ ...target, quitting: true }), target.platform).toBe(false)
      expect(shouldQuitWhenWindowsGone({ ...target, quitting: true }), target.platform).toBe(true)
    }
  })
})

describe('canSurviveWithoutWindow', () => {
  it('is the tray on Windows and Linux, and the dock on macOS', () => {
    expect(canSurviveWithoutWindow(WITH_TRAY)).toBe(true)
    expect(canSurviveWithoutWindow({ hasTray: true, platform: 'linux' })).toBe(true)
    expect(canSurviveWithoutWindow(MAC)).toBe(true)
    expect(canSurviveWithoutWindow(NO_TRAY)).toBe(false)
    expect(canSurviveWithoutWindow({ hasTray: false, platform: 'win32' })).toBe(false)
  })
})
