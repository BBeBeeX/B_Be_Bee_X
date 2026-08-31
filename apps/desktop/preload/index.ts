/**
 * The preload bridge.
 *
 * Exposes one frozen object, `window.BBeBee`, carrying only what the renderer
 * genuinely cannot do for itself. Every method is mechanical — no domain
 * concepts cross this boundary (docs/02 §2).
 */

import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '@BBeBee/core-desktop-bridge'

const api = {
  paths: {
    get: (kind: string): Promise<string | undefined> => ipcRenderer.invoke('paths:get', kind),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  },
  dialog: {
    pickDirectory: (): Promise<string | undefined> => ipcRenderer.invoke('dialog:pickDirectory'),
  },
  platform: process.platform,
  versions: { electron: process.versions.electron, node: process.versions.node },
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
  txBegin: () => ipcRenderer.invoke(CH.txBegin),
  txEnd: (token: string, commit: boolean) => ipcRenderer.invoke(CH.txEnd, token, commit),
})
