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
  /**
   * `main → renderer`, the only direction that is not request/response.
   *
   * Needed because some things originate in `main` and cannot be polled: a
   * media key was pressed, the OS is about to suspend. Everything else stays
   * a call, so this channel carries a *topic* and a payload and nothing else.
   */
  event: 'BBeBee:event',
} as const

/** Services reachable over the bridge. */
export type BridgedService = 'fs' | 'db' | 'paths' | 'system'

/**
 * Topics `main` may push to the renderer.
 *
 * Enumerated rather than open, so the renderer cannot be made to dispatch on
 * a topic nothing registered — and so the whole main→renderer surface is one
 * list to read.
 */
export type BridgeEvent =
  /** Exactly `MediaKey` from the protocol — main does the OS-name mapping. */
  | { topic: 'media-key'; key: 'play-pause' | 'next' | 'previous' | 'stop' }
  | { topic: 'hotkey'; accelerator: string }
  | { topic: 'will-suspend' }
  | { topic: 'power'; charging: boolean; level: number }
  | { topic: 'transport'; command: string; positionMs?: number }

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
  /** Subscribe to `main`'s pushes. Returns an unsubscribe. */
  on(handler: (event: BridgeEvent) => void): () => void
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

/**
 * The OS keychain, as `ctx.secrets` needs it.
 *
 * `safeStorage` is main-only, so this is three IPC calls — and no key crosses
 * the bridge in either direction, because there is no key to cross: the OS
 * holds it. Without this the desktop store falls back to XOR against a
 * path-derived key, which is obfuscation rather than protection.
 */
export interface SecretsBridge {
  available(): Promise<boolean>
  encrypt(plain: string): Promise<string>
  decrypt(cipher: string): Promise<string>
}

/**
 * A `SecretCrypto` over the preload bridge, or `undefined` where there is none.
 *
 * Returning `undefined` rather than throwing is deliberate: a build with no
 * keychain — a Linux box with no libsecret, a test — should still start, with
 * `isHardwareBacked` false so the UI can say what it is running on.
 */
export function safeStorageCodec(): {
  encrypt(plain: string): Promise<string>
  decrypt(cipher: string): Promise<string>
  readonly isHardwareBacked: true
} | undefined {
  /*
   * Read structurally rather than through a `declare global`.
   *
   * The shell's preload owns the shape of `window.BBeBee` and declares it; a
   * second declaration here would conflict with that one rather than extend
   * it, and this package has no business owning a shape it does not build.
   */
  const exposed = (globalThis as { window?: { BBeBee?: { secrets?: SecretsBridge } } }).window
  const bridge = exposed?.BBeBee?.secrets
  if (!bridge) return undefined
  return {
    isHardwareBacked: true,
    encrypt: (plain) => bridge.encrypt(plain),
    decrypt: (cipher) => bridge.decrypt(cipher),
  }
}
