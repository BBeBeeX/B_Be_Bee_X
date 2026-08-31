/**
 * The wire format between the Electron renderer and main.
 *
 * Deliberately mechanical: a service name, a method name, and JSON-ish
 * arguments. No domain concept crosses this boundary — `main` does not learn
 * what a track is (docs/02 §2).
 */

/** IPC channel names. One per shape of call, not one per method. */
export const CH = {
  /** `(service, method, args) => result` */
  call: 'BBeBee:call',
  /** `(uri, range) => handle` — opens a chunked read. */
  streamOpen: 'BBeBee:stream:open',
  /** `(handle) => Uint8Array | null` — null ends the stream. */
  streamPull: 'BBeBee:stream:pull',
  streamClose: 'BBeBee:stream:close',
  /** `() => token` — begins a db transaction that later calls join. */
  txBegin: 'BBeBee:tx:begin',
  txEnd: 'BBeBee:tx:end',
} as const

/** Services reachable over the bridge. */
export type BridgedService = 'fs' | 'db' | 'paths'

export interface BridgeApi {
  call(
    service: BridgedService,
    method: string,
    args: unknown[],
    /** Routes a db call into an open transaction. See main.ts. */
    token?: string,
  ): Promise<unknown>
  streamOpen(uri: string, range?: { start: number; end?: number }): Promise<number>
  streamPull(handle: number): Promise<Uint8Array | null>
  streamClose(handle: number): Promise<void>
  /** Returns a token; subsequent `call`s pass it to join the transaction. */
  txBegin(): Promise<string>
  txEnd(token: string, commit: boolean): Promise<void>
}

declare global {
  interface Window {
    BBeBeeBridge?: BridgeApi
  }
}

export function requireBridge(): BridgeApi {
  const bridge = globalThis.window?.BBeBeeBridge
  if (!bridge) {
    throw new Error(
      'BBeBee: the preload bridge is missing. The renderer cannot reach the ' +
        'filesystem or database without it — check that `preload/index.cjs` loaded.',
    )
  }
  return bridge
}
