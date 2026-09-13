/**
 * Electron main process — a thin native host.
 *
 * Per ADR-3 the Cordis kernel lives in the **renderer**; this process owns the
 * window, the OS, and Node, and contains **no business logic**. It does not
 * know what a track is. Every handler here is mechanical and has a direct
 * counterpart in an Expo module on the mobile side.
 *
 * See docs/02-architecture.md §2.
 */

import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  shell,
  Tray,
  Menu,
  session,
} from 'electron'
import { createHost, type Host } from '@BBeBee/core-desktop-bridge/main'
import {
  shouldHideOnClose,
  shouldQuitWhenWindowsGone,
  type CloseContext,
} from './window-policy.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Only web URLs may be handed to the OS.
 *
 * `shell.openExternal` launches whatever handler the OS has registered, so
 * `file://`, `smb://` and custom protocol handlers become an execution
 * primitive for anything that can reach this call. Electron's own security
 * guidance is to allow http(s) and nothing else.
 */
function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Set when the user genuinely means to leave.
 *
 * MD-6: closing the window *hides* it, because the kernel — and therefore the
 * audio graph — lives in the renderer, so destroying the window would stop the
 * music (docs/11 §1.3, docs/10 §M1). Quit goes through the tray or the app
 * menu, and sets this first.
 */
let quitting = false

let tray: Tray | undefined
let mainWindow: BrowserWindow | undefined

function isDebug(): boolean {
  const val = process.env['DEBUG'] || process.env['BBEBEE_DEBUG']
  if (val && val !== '0' && val !== 'false') return true
  return process.argv.includes('--debug')
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0B0B0F',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      // The security posture from docs/02 §2. None of these are negotiable:
      // the renderer hosts third-party plugin code (docs/03 §6.2).
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(here, '../preload/index.cjs'),
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(here, '../renderer/index.html'))
  }

  // Forward renderer logs (from plugin-log-console) to the terminal stdout only in debug mode.
  if (isDebug()) {
    window.webContents.on('console-message', (_event, _level, message) => {
      process.stdout.write(`${message}\n`)
    })
  }

  // External links open in the user's browser, never in an app window — an
  // app-window navigation would run untrusted content beside the preload.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  /*
   * Close-to-tray (MD-6).
   *
   * `preventDefault` keeps the renderer — and with it the kernel, the queue
   * and the audio graph — alive. Without this, "close the window" and "stop
   * the music" are the same gesture, which is the one thing the exit criterion
   * "playback survives window-hide" forbids.
   *
   * ⚠️ Only where the window can be got back. A Linux session with no
   * StatusNotifier host has no tray, and hiding the last window there leaves a
   * process with no window, no tray and no dock — running, playing, and
   * impossible to reach or quit except from a terminal. Losing playback on
   * close is worse than the alternative everywhere the tray exists, and much
   * better than that.
   */
  window.on('close', (event) => {
    if (!shouldHideOnClose(closeContext())) return
    event.preventDefault()
    window.hide()
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })

  return window
}

/** The three facts the window policy decides from. */
function closeContext(): CloseContext {
  return { quitting, hasTray: tray !== undefined, platform: process.platform }
}

function showWindow(): void {
  const window = mainWindow ?? createWindow()
  mainWindow = window
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * The tray, and deliberately nothing more.
 *
 * MD-6 puts the mini-player in a later milestone: this exists so a hidden
 * window is reachable and the app is quittable, which is the whole of what
 * close-to-tray owes the user.
 *
 * The icon is generated rather than shipped as a file — a 1×1 transparent
 * image that every platform renders as its default tray slot — because a
 * missing icon file makes `new Tray()` throw and take the boot with it.
 */
function createTray(): Tray | undefined {
  try {
    const icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    )
    const created = new Tray(icon)
    created.setToolTip('BBeBee')
    created.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show BBeBee', click: () => showWindow() },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            quitting = true
            app.quit()
          },
        },
      ]),
    )
    created.on('click', () => showWindow())
    return created
  } catch {
    // A Linux session with no StatusNotifier host has no tray. The window
    // still hides on close and is reachable from the dock or the app menu.
    return undefined
  }
}

/**
 * The IPC surface.
 *
 * Deliberately tiny: `paths` and `safeStorage` are the things the renderer
 * genuinely cannot do for itself. Everything else that needs Node goes through
 * `createHost` below, which is machinery rather than app surface.
 */
function registerHandlers(): void {
  ipcMain.handle('paths:get', (_event, kind: string) => {
    try {
      return app.getPath(kind as Parameters<typeof app.getPath>[0])
    } catch {
      // Not every kind exists on every platform; `undefined` is the contract.
      return undefined
    }
  })

  /*
   * The OS keychain, which only `main` can reach.
   *
   * ⚠️ Without this the desktop credential store falls back to XOR against a
   * key derived from the install path — obfuscation, not protection, and the
   * shipped build was running on it because nothing ever injected a real
   * codec. `isHardwareBacked` was honest about it, but honesty is not the
   * feature; the keychain is.
   *
   * Encryption happens here rather than in the renderer because
   * `safeStorage` is main-only. The renderer sends a string and receives an
   * opaque one back; the key never crosses the bridge, because there is no
   * key to cross — `safeStorage` holds it in the OS.
   */
  ipcMain.handle('secrets:available', () => safeStorage.isEncryptionAvailable())

  ipcMain.handle('secrets:encrypt', (_event, plain: string) => {
    if (typeof plain !== 'string') throw new Error('secrets: expected a string')
    return safeStorage.encryptString(plain).toString('base64')
  })

  ipcMain.handle('secrets:decrypt', (_event, cipher: string) => {
    if (typeof cipher !== 'string') throw new Error('secrets: expected a string')
    // A value written by another install, or on another machine, will not
    // decrypt. Throwing is right: the store treats it as absent and asks the
    // user to sign in again, which is recoverable.
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!isWebUrl(url)) throw new Error(`refusing to open a non-web url: ${url}`)
    await shell.openExternal(url)
  })

  ipcMain.handle('dialog:pickDirectory', async (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    const window = target && !target.isDestroyed() ? target : undefined
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? undefined : result.filePaths[0]
  })

  ipcMain.handle('window:minimize', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    target?.minimize()
  })

  ipcMain.handle('window:maximize', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (target) {
      if (target.isMaximized()) {
        target.unmaximize()
      } else {
        target.maximize()
      }
    }
  })

  ipcMain.handle('window:close', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    target?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    return target?.isMaximized() ?? false
  })
}

/** Media keys, as the protocol names them. */
const MEDIA_KEYS: Record<string, 'play-pause' | 'next' | 'previous' | 'stop'> = {
  MediaPlayPause: 'play-pause',
  MediaNextTrack: 'next',
  MediaPreviousTrack: 'previous',
  MediaStop: 'stop',
}

/**
 * The OS integrations `ctx.device`, `ctx.background` and `ctx.mediaSession`
 * reach through the bridge.
 *
 * Every one of these was a no-op until now: `createHost` was called without a
 * `system` option, so `acquireWakeLock` resolved and blocked nothing, and a
 * media key reached nothing at all.
 */
function systemHost(host: () => Host | undefined) {
  /** `powerSaveBlocker` ids, keyed by the renderer's lock id. */
  const blockers = new Map<number, number>()
  const hotkeys = new Set<string>()

  return {
    acquireWakeLock(id: number, reason: string): void {
      if (blockers.has(id)) return
      // `prevent-app-suspension` keeps the process scheduled without keeping
      // the display awake — the right one for audio, which does not need a
      // lit screen and should not burn a laptop battery holding one.
      void reason
      blockers.set(id, powerSaveBlocker.start('prevent-app-suspension'))
    },
    releaseWakeLock(id: number): void {
      const blocker = blockers.get(id)
      if (blocker === undefined) return
      blockers.delete(id)
      if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
    },

    watchMediaKeys(on: boolean): void {
      for (const [accelerator, key] of Object.entries(MEDIA_KEYS)) {
        if (on) {
          // Registration fails when another app holds the key. That is a
          // feature lost, not a boot lost.
          try {
            globalShortcut.register(accelerator, () => {
              host()?.emit({ topic: 'media-key', key })
            })
          } catch {
            /* another app owns it */
          }
        } else {
          globalShortcut.unregister(accelerator)
        }
      }
    },

    registerHotkey(accelerator: string): void {
      if (hotkeys.has(accelerator)) return
      try {
        globalShortcut.register(accelerator, () => {
          host()?.emit({ topic: 'hotkey', accelerator })
        })
        hotkeys.add(accelerator)
      } catch {
        /* an unparseable or taken accelerator costs one hotkey */
      }
    },
    unregisterHotkey(accelerator: string): void {
      if (!hotkeys.delete(accelerator)) return
      globalShortcut.unregister(accelerator)
    },

    /*
     * ⚠️ MPRIS, SMTC and the macOS Now Playing centre.
     *
     * Chromium publishes all three itself from the renderer's
     * `navigator.mediaSession`, which `core-media-session-electron` already
     * drives — but only while an `HTMLMediaElement` is playing. That is true
     * for a streamed source and false for a buffered one, which plays through
     * an `AudioBufferSourceNode` and is invisible to the OS.
     *
     * Electron exposes no API to publish a session without an element, so
     * these stay no-ops and the tooltip carries what it can. Closing the gap
     * needs a native module per platform; it is named in docs/11 §6 as a
     * manual check for exactly this reason, and the honest behaviour meanwhile
     * is to do nothing rather than to look like it worked.
     */
    publishNowPlaying(nowPlaying: unknown): void {
      const title = (nowPlaying as { title?: string } | undefined)?.title
      tray?.setToolTip(typeof title === 'string' && title ? `BBeBee — ${title}` : 'BBeBee')
    },
    publishPlaybackState(): void {},
    setSupportedCommands(): void {},
    clearNowPlaying(): void {
      tray?.setToolTip('BBeBee')
    },
  }
}

/**
 * Privileged custom scheme for local media/artwork assets.
 *
 * Chromium sandboxes the renderer with contextIsolation and strict CSP,
 * disallowing direct `file://` fetch/rendering. `bbebee-file://` serves
 * local files through Electron's net.fetch in the main process.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bbebee-file',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  /*
   * Stream request headers, keyed at three granularities — origin, hostname,
   * and the hostname's registrable domain.
   *
   * Registered per resolved stream by the player (through the preload bridge)
   * and applied below by `onBeforeSendHeaders`, because a media element's
   * request cannot set `Referer`/`User-Agent` itself and the CDNs that need
   * them refuse the request without.
   *
   * ⚠️ Keyed by host, never by the exact URL. A per-URL map has two defects:
   * it grows by an entry per resolved track for as long as the app runs, and
   * it loses the redirect — a CDN routinely answers a mirror with a 302 to
   * another mirror of the same domain, and only the domain key survives that.
   */
  const streamHeaders = new Map<string, Record<string, string>>()

  ipcMain.handle(
    'stream:set-headers',
    (_event, entry: { url: string; headers: Record<string, string> }) => {
      if (!entry?.url || !entry?.headers) return
      try {
        const u = new URL(entry.url)
        const labels = u.hostname.split('.')
        const domain = labels.slice(-2).join('.')
        streamHeaders.set(u.origin, entry.headers)
        streamHeaders.set(u.hostname, entry.headers)
        if (labels.length > 2) streamHeaders.set(domain, entry.headers)
      } catch {
        // ignore invalid url
      }
    },
  )

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const u = new URL(details.url)
      const labels = u.hostname.split('.')
      const matched =
        streamHeaders.get(u.origin) ??
        streamHeaders.get(u.hostname) ??
        (labels.length > 2 ? streamHeaders.get(labels.slice(-2).join('.')) : undefined)
      if (matched) {
        for (const [k, v] of Object.entries(matched)) {
          details.requestHeaders[k] = v
        }
      }
    } catch {
      // ignore header inspection error
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  protocol.handle('bbebee-file', (request) => {
    const fileUrl = request.url.replace(/^bbebee-file:\/\//, 'file:///')
    return net.fetch(fileUrl)
  })

  registerHandlers()

  // A holder rather than a bare binding: `systemHost` needs to reach the host
  // to emit events, and it is constructed as an argument *to* the call that
  // creates it. The indirection is the knot being tied, not an accident.
  const bridge: { host?: Host } = {}
  // The real fs/db live here, in main. ADR-3 puts the kernel in the renderer,
  // which is sandboxed and cannot reach Node — so the renderer's core services
  // are thin IPC clients over this host (docs/02 §2).
  bridge.host = await createHost(
    {
      handle: ipcMain.handle.bind(ipcMain),
      removeHandler: ipcMain.removeHandler.bind(ipcMain),
      broadcast: (channel, payload) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(channel, payload)
        }
      },
    },
    {
      appName: 'BBeBee',
      resolvePath: (kind) => {
        try {
          return app.getPath(kind as Parameters<typeof app.getPath>[0])
        } catch {
          return undefined
        }
      },
      /*
       * `ctx.http`'s transport.
       *
       * `net.fetch` uses Chromium's network stack from `main`, where no CORS
       * policy applies and every header is settable — which is what a source
       * pointed at someone else's Navidrome needs (docs/11 §4.5).
       */
      httpFetch: (url, init) =>
        net.fetch(url, init as Parameters<typeof net.fetch>[1]) as never,
      system: systemHost(() => bridge.host),
      pickDirectory: async (sender) => {
        const target = (sender ? BrowserWindow.fromWebContents(sender as Electron.WebContents) : undefined) ?? mainWindow
        const window = target && !target.isDestroyed() ? target : undefined
        const result = window
          ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory'] })
        return result.canceled ? undefined : result.filePaths[0]
      },
    },
  )

  /*
   * Suspend, forwarded so `ctx.background.onWillSuspend` is a hook that
   * actually fires — the player checkpoints its position on it, and a hook
   * that never fires is worse than no hook (docs/11 §4.3).
   */
  powerMonitor.on('suspend', () => bridge.host?.emit({ topic: 'will-suspend' }))

  tray = createTray()
  mainWindow = createWindow()

  app.on('activate', () => {
    showWindow()
  })
})

/**
 * Quit is an explicit act.
 *
 * MD-6 keeps the renderer alive when the window closes, so `window-all-closed`
 * now fires only when something destroyed the window on purpose. The tray and
 * the app menu set `quitting` first.
 */
app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  // Reached only when a window was genuinely destroyed: either the user is
  // quitting, or this build has nowhere to hide to and the close went through.
  if (shouldQuitWhenWindowsGone(closeContext())) app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  tray?.destroy()
  tray = undefined
})
