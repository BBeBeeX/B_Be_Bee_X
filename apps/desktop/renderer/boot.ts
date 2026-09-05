/**
 * The desktop bootstrap.
 *
 * This file *is* the platform-specific surface of the desktop app: a list of
 * which core services to register, and which plugins to enable. Everything
 * after it — every feature plugin, every contribution — is identical to mobile
 * (docs/02 §3).
 *
 * The registry itself is **generated** (`pnpm gen:plugins`), so adding a
 * plugin package is not also an edit to two shells that can disagree
 * (docs/03 §6.1). What stays hand-written is the config: configuration is the
 * allowlist, so a package being bundled is not on its own enough to run it.
 */

import { createApp, type App } from '@BBeBee/kernel'
// The renderer is sandboxed, so these are IPC clients over the main-process
// host — not the node implementations, which cannot load here (docs/02 §2).
import {
  DbBridge,
  FsBridge,
  PathsBridge,
  bridgeFetch,
  fetchPaths,
  safeStorageCodec,
} from '@BBeBee/core-desktop-bridge'
import { StoreFs } from '@BBeBee/core-store-fs'
import { DeviceElectron } from '@BBeBee/core-device-electron'
import { BackgroundElectron } from '@BBeBee/core-background-electron'
import { MediaSessionElectron } from '@BBeBee/core-media-session-electron'
import { SecretsNode } from '@BBeBee/core-secrets-node'
import { JsQuickJsNode } from '@BBeBee/core-js-quickjs-node'
import { CodecNode } from '@BBeBee/core-codec-node'
import { HttpNode } from '@BBeBee/core-http-node'
import { AudioWebAudio } from '@BBeBee/core-audio-webaudio'

import { bundled } from '../generated/plugins.js'
import { BOOTSTRAP_SERVICES, ENABLED } from './plugins.js'

declare global {
  interface Window {
    BBeBee?: {
      paths: { get(kind: string): Promise<string | undefined> }
      shell: { openExternal(url: string): Promise<void> }
      dialog: { pickDirectory(): Promise<string | undefined> }
      platform: string
      versions: { electron: string; node: string }
    }
  }
}

const APP_VERSION = '0.0.0'

/** Electron's `process.platform`, as the protocol names it. */
function hostPlatform(): 'macos' | 'windows' | 'linux' {
  const raw = window.BBeBee?.platform ?? 'linux'
  return raw === 'darwin' ? 'macos' : raw === 'win32' ? 'windows' : 'linux'
}

/**
 * What the renderer can actually decode.
 *
 * Chromium's list, asked rather than assumed — `ctx.codec` reads tags and does
 * not decode, so it cannot know this on its own, and the scanner reports what
 * it could not import rather than skipping it silently (docs/04 §13).
 */
function decodableFormats(): string[] {
  const probe = document.createElement('audio')
  const candidates: [string, string][] = [
    ['mp3', 'audio/mpeg'],
    ['flac', 'audio/flac'],
    ['m4a', 'audio/mp4; codecs="mp4a.40.2"'],
    ['aac', 'audio/aac'],
    ['wav', 'audio/wav'],
    ['ogg', 'audio/ogg; codecs="vorbis"'],
    ['opus', 'audio/ogg; codecs="opus"'],
  ]
  return candidates.filter(([, mime]) => probe.canPlayType(mime) !== '').map(([name]) => name)
}

export async function boot(): Promise<App> {
  // Resolved once: the bridge is either there or it is not.
  const keychain = safeStorageCodec()

  // Paths are fetched once, up front: `PathsService` promises synchronous
  // access and IPC cannot provide it.
  const pathSnapshot = await fetchPaths()

  /*
   * HTTP runs in `main`.
   *
   * The renderer is a browser context: cross-origin requests need the
   * server's permission and `Cookie`/`Range`/`User-Agent` cannot be set. A
   * music server run by a stranger grants none of that, so without this every
   * imported source fails for a reason that has nothing to do with the source
   * (docs/02 §2, docs/11 §4.5). `undefined` — an older preload — falls back to
   * the renderer's own `fetch`, which is worse but is not a boot failure.
   */
  const transport = bridgeFetch()

  const app = createApp({
    target: 'desktop',
    bootstrap: [
      [PathsBridge, pathSnapshot],
      FsBridge,
      StoreFs,
      DbBridge,
      // The OS-facing trio. Each degrades to "no OS surface" rather than
      // throwing when the platform does not provide one, so a Linux box with
      // no MPRIS daemon still boots (docs/11 §4.3, §4.4).
      [DeviceElectron, { appVersion: APP_VERSION, platform: hostPlatform() }],
      BackgroundElectron,
      MediaSessionElectron,
      /*
       * The keychain where there is one.
       *
       * ⚠️ Without a codec the store falls back to XOR against a path-derived
       * key — obfuscation, not protection — and `isHardwareBacked` reports
       * false so nothing downstream mistakes it for more. Passing
       * `safeStorage` here is what makes the desktop guarantee real rather
       * than documented.
       *
       * Before `HttpNode`, because the jar store is built from it: cookies are
       * credential material and are envelope-encrypted under a key that lives
       * in the credential store (docs/04 §2.1).
       */
      [SecretsNode, keychain ? { crypto: keychain } : {}],
      JsQuickJsNode,

      /*
       * The M1 platform floor.
       *
       * ⚠️ These are bootstrap entries rather than registry ones even though
       * they carry manifests, because the services they provide are required
       * — not optional — for the feature plugins above them: `plugin-player`
       * injects `audio`, `plugin-local-scanner` injects `codec`, and
       * `plugin-source-runtime` injects `http`. A required dependency that
       * arrives through the same allowlist as the thing depending on it can be
       * switched off from the wrong end, and the symptom is a fiber that sits
       * PENDING with no obvious cause.
       */
      [CodecNode, { supportedFormats: decodableFormats() }],
      [HttpNode, transport ? { fetch: transport } : {}],
      /*
       * `ctx.audio`. The renderer's own `AudioContext` satisfies the ADR-4
       * contract, which *is* the standard Web Audio API — so this is the same
       * package mobile loads, with a different context factory (docs/05 §1).
       */
      AudioWebAudio,
    ],
    registry: bundled,
    config: { plugins: ENABLED },
  })
  await app.start()

  /*
   * Every core service this shell claims to provide must actually be there.
   *
   * ⚠️ This is the check whose absence let the desktop build ship without
   * `ctx.audio`, `ctx.codec` or `ctx.http`: `plugin-player` was commented out,
   * the scanner and the source runtime sat PENDING, and nothing said so — the
   * app started, drew a library screen, and could not play a note. A fiber
   * waiting forever for a service that will never arrive is indistinguishable
   * from one that is merely slow, so the only place to catch it is here, where
   * the list of what was registered is known.
   */
  await app.ready([...BOOTSTRAP_SERVICES], { timeoutMs: 15_000 })
  return app
}
