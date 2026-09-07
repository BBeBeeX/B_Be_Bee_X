/**
 * The mobile bootstrap — the **composition root**.
 *
 * One of docs/02 §1's three deliberate exceptions to the layer model, named by
 * path in `eslint.config.js`: the only files allowed to call `createApp` and
 * to import a Layer 2 `core-*` package directly. Wiring, not business
 * function — everything else under `apps/` is plain Layer 4.
 *
 * Compare with `apps/desktop/renderer/boot.ts`: the plugin registry is
 * generated from the same manifests and the config is the same list, and only
 * the core-service registrations differ. That is ADR-3 and the layer model
 * working (docs/02 §3).
 *
 * This file is also the *only* place `react-native` is imported outside a view
 * package: the kit takes its primitives from here, so nothing below the shell
 * has to know what it is rendering into (docs/08 §1).
 */

import { Platform } from 'react-native'
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { AudioContext, AudioManager } from 'react-native-audio-api'
import { createApp, type App } from '@BBeBee/kernel'
import { PathsExpo } from '@BBeBee/core-paths-expo'
import { FsExpo } from '@BBeBee/core-fs-expo'
import { StoreFs } from '@BBeBee/core-store-fs'
import { DbExpo } from '@BBeBee/core-db-expo'
import { SecretsExpo } from '@BBeBee/core-secrets-expo'
import { DeviceExpo } from '@BBeBee/core-device-expo'
import { BackgroundExpo } from '@BBeBee/core-background-expo'
import { MediaSessionRn } from '@BBeBee/core-media-session-rn'
import { CodecRn } from '@BBeBee/core-codec-rn'
import { HttpRn } from '@BBeBee/core-http-rn'
import { AudioWebAudio } from '@BBeBee/core-audio-webaudio'
import { configureNative } from '@BBeBee/ui-kit-mobile'

import { bundled } from '../generated/plugins'
import { BOOTSTRAP_SERVICES, ENABLED } from './plugins'

/**
 * Hand the kit its primitives, once, before anything renders.
 *
 * `ui-kit-mobile` deliberately does not import `react-native` itself — that is
 * what lets it be unit-tested off-device — so a shell that forgets this call
 * gets host elements named `View` and `Text` and an obviously wrong screen
 * (docs/08 §6).
 */
configureNative({
  View,
  Text,
  Pressable,
  Image,
  Modal,
  FlashList,
  ActivityIndicator,
  TextInput,
})

/**
 * The audio session, started before the graph.
 *
 * `setAudioSessionActivity(true)` is what buys background time: iOS keeps the
 * process scheduled for `UIBackgroundModes: audio`, and Android's media
 * notification holds a foreground service. `ctx.background` reports
 * `canRunInBackground()` from this rather than hardcoding it, so the two
 * cannot disagree (docs/11 §4.3).
 */
async function startAudioSession(background: BackgroundExpo): Promise<void> {
  try {
    AudioManager.observeAudioInterruptions(true)
    await AudioManager.setAudioSessionActivity(true)
    background.setSessionActive(true)
  } catch {
    // A build without the native module, or a refused session. Playback will
    // fail later with a message about audio; the app still starts.
    background.setSessionActive(false)
  }
}

export async function boot(): Promise<App> {
  const app = createApp({
    target: Platform.OS === 'ios' ? 'ios' : 'android',
    bootstrap: [
      PathsExpo,
      FsExpo,
      StoreFs,
      DbExpo,
      // The keychain. Cookie jars are envelope-encrypted under a key that
      // lives here, so it comes before `HttpRn` (docs/04 §2.1).
      SecretsExpo,

      [DeviceExpo, { appVersion: '0.0.0' }],
      BackgroundExpo,
      MediaSessionRn,

      /*
       * The M1 platform floor.
       *
       * Bootstrap entries rather than registry ones, for the same reason as on
       * desktop: `plugin-player` injects `audio`, `plugin-local-scanner`
       * injects `codec` and `plugin-source-runtime` injects `http`. A required
       * dependency reachable through the same config allowlist as its
       * dependent can be switched off from the wrong end, and the symptom is a
       * fiber sitting PENDING with no obvious cause.
       */
      CodecRn,
      HttpRn,
      /*
       * `ctx.audio`. The same package desktop loads — ADR-4's contract *is*
       * the Web Audio API, and `react-native-audio-api` satisfies it — with
       * this platform's context factory passed in (docs/05 §1).
       */
      [
        AudioWebAudio,
        {
          createContext: () => new AudioContext(),
          /*
           * ⚠️ No `createMediaElement`.
           *
           * React Native has no `HTMLMediaElement`, so `load({ strategy:
           * 'stream' })` has nothing to stream through and the engine refuses
           * it rather than pretending. Buffered playback — every local file,
           * and short remote ones — is unaffected; a long remote track is the
           * gap, and it is the device work docs/11 §3.1 puts on
           * `StreamerNode` (docs/05 §1).
           */
          fallbackLatencyMs: 100,
        },
      ],
    ],
    registry: bundled,
    config: { plugins: ENABLED },
  })
  await app.start()

  /*
   * Every core service this shell claims to provide must actually be there.
   *
   * ⚠️ The check whose absence let this shell ship as M0 for a whole milestone:
   * it bootstrapped four services and the M0 demo plugin while every M1 package sat
   * built, tested and unreferenced. A fiber waiting forever for a service that
   * will never arrive is indistinguishable from one that is merely slow, so the
   * only place to catch it is here, where what was registered is known.
   */
  await app.ready([...BOOTSTRAP_SERVICES], { timeoutMs: 15_000 })
  await startAudioSession(app.ctx.background as BackgroundExpo)
  return app
}
