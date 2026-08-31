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

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createHost } from '@BBeBee/core-desktop-bridge/main'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0B0B0F',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
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

  // External links open in the user's browser, never in an app window — an
  // app-window navigation would run untrusted content beside the preload.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  return window
}

/**
 * The IPC surface.
 *
 * Deliberately tiny for M0: `paths` is the only thing the renderer cannot
 * work out for itself, since `app.getPath()` is main-only. `fs` and `db` run
 * in the renderer for now (see the note in `renderer/boot.ts`); moving them
 * behind IPC is a swap of the core plugin, not a change to any feature.
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

  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url))

  ipcMain.handle('dialog:pickDirectory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? undefined : result.filePaths[0]
  })
}

void app.whenReady().then(async () => {
  registerHandlers()
  // The real fs/db live here, in main. ADR-3 puts the kernel in the renderer,
  // which is sandboxed and cannot reach Node — so the renderer's core services
  // are thin IPC clients over this host (docs/02 §2).
  await createHost(ipcMain, {
    appName: 'BBeBee',
    resolvePath: (kind) => {
      try {
        return app.getPath(kind as Parameters<typeof app.getPath>[0])
      } catch {
        return undefined
      }
    },
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // ⚠️ ADR-3's cost: the kernel lives in the renderer, so closing the last
  // window ends the app. Close-to-tray (so playback survives) is M1's job,
  // once there is playback to survive.
  if (process.platform !== 'darwin') app.quit()
})
