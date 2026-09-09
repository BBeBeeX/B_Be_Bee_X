/**
 * The preload bridge.
 *
 * Exposes one frozen object, `window.BBeBee`, carrying only what the renderer
 * genuinely cannot do for itself. Every method is mechanical — no domain
 * concepts cross this boundary (docs/02 §2).
 */

import { contextBridge, ipcRenderer } from 'electron'
// The channel names only — the package root pulls in cordis, and a sandboxed
// preload has no `require` for anything but Electron's own modules.
import { CH } from '@BBeBee/core-desktop-bridge/protocol'

const api = {
  paths: {
    get: (kind: string): Promise<string | undefined> => ipcRenderer.invoke('paths:get', kind),
  },
  /**
   * The OS keychain, reachable only from `main`.
   *
   * Three calls and no key: `safeStorage` holds the key in the OS, so nothing
   * secret crosses this bridge in either direction — a plaintext string goes
   * one way and an opaque one comes back.
   */
  secrets: {
    available: (): Promise<boolean> => ipcRenderer.invoke('secrets:available'),
    encrypt: (plain: string): Promise<string> => ipcRenderer.invoke('secrets:encrypt', plain),
    decrypt: (cipher: string): Promise<string> => ipcRenderer.invoke('secrets:decrypt', cipher),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  },
  dialog: {
    pickDirectory: (): Promise<string | undefined> => ipcRenderer.invoke('dialog:pickDirectory'),
  },
  platform: process.platform,
  versions: { electron: process.versions.electron, node: process.versions.node },
  isDebug: Boolean(
    (process.env['DEBUG'] && process.env['DEBUG'] !== '0' && process.env['DEBUG'] !== 'false') ||
    process.env['BBEBEE_DEBUG'] ||
    process.argv.includes('--debug'),
  ),
} as const

export type BBeBeeBridge = typeof api

contextBridge.exposeInMainWorld('BBeBee', api)

/**
 * The core-service bridge.
 *
 * Separate from `BBeBee` above because it is machinery, not app surface: the
 * renderer's `ctx.fs`/`ctx.db` forward through here. Still only mechanical
 * calls — no domain concept crosses (docs/02 §2).
 */
contextBridge.exposeInMainWorld('BBeBeeBridge', {
  call: (service: string, method: string, args: unknown[], token?: string) =>
    ipcRenderer.invoke(CH.call, service, method, args, token),
  streamOpen: (uri: string, range?: { start: number; end?: number }) =>
    ipcRenderer.invoke(CH.streamOpen, uri, range),
  streamPull: (handle: number) => ipcRenderer.invoke(CH.streamPull, handle),
  streamClose: (handle: number) => ipcRenderer.invoke(CH.streamClose, handle),
  /**
   * HTTP performed in `main`.
   *
   * Here rather than in the renderer because the renderer is a browser
   * context: CORS applies, and `Cookie`/`User-Agent`/`Range` cannot be set.
   * Neither is true of a music server's expectations (docs/02 §2).
   */
  httpOpen: (request: unknown) => ipcRenderer.invoke(CH.httpOpen, request),
  httpPull: (handle: number) => ipcRenderer.invoke(CH.httpPull, handle),
  httpClose: (handle: number) => ipcRenderer.invoke(CH.httpClose, handle),
  txBegin: () => ipcRenderer.invoke(CH.txBegin),
  txEnd: (token: string, commit: boolean) => ipcRenderer.invoke(CH.txEnd, token, commit),
  /**
   * The one main→renderer channel.
   *
   * The listener is wrapped rather than passed through, so the renderer never
   * receives Electron's `IpcRendererEvent` — which carries `sender` and would
   * hand a plugin a reference back across the boundary.
   */
  on: (handler: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => handler(payload)
    ipcRenderer.on(CH.event, listener)
    return () => void ipcRenderer.removeListener(CH.event, listener)
  },
})
