/**
 * `ctx.background` on iOS and Android.
 *
 * Three unrelated promises, kept by three unrelated mechanisms:
 *
 * - **`canRunInBackground()`** — derived, never hardcoded (docs/11 §4.3). On
 *   mobile it is true only while the audio session is active, because that is
 *   literally what buys the process time: iOS keeps an app scheduled for
 *   `UIBackgroundModes: audio` and Android keeps it alive for a foreground
 *   media service. With no audio playing, the honest answer is `false`, and
 *   the UI says so rather than showing a progress bar that will stall.
 * - **`acquireWakeLock`** — `expo-keep-awake`, which maps to
 *   `FLAG_KEEP_SCREEN_ON` / `isIdleTimerDisabled`.
 * - **`schedule`** — `expo-background-task`, the OS scheduler. The interval is
 *   a hint; a run may be hours late or never happen, and the contract already
 *   says so.
 *
 * `onWillSuspend` is `AppState`, which is the only signal either platform
 * gives before the process stops being scheduled. It has to actually fire —
 * the player checkpoints its position on it, and everything downstream trusts
 * it (docs/11 §4.3).
 *
 * See docs/04 §12 and docs/11 §4.3.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as BackgroundTask from 'expo-background-task'
import * as TaskManager from 'expo-task-manager'
import { AudioManager } from 'react-native-audio-api'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { BackgroundService, Disposable } from '@BBeBee/protocol'

export interface BackgroundExpoConfig {
  /**
   * The audio session category to claim while playing.
   *
   * `playback` is what keeps the process alive with the screen off, and is why
   * `canRunInBackground()` can ever be true. Anything else is a different app.
   */
  iosCategory?: 'playback' | 'ambient' | 'soloAmbient'
}

export class BackgroundExpo extends Service implements BackgroundService {
  private readonly suspendListeners = new Set<() => void | Promise<void>>()
  private readonly wakeLocks = new Set<string>()
  private readonly tasks = new Map<string, () => Promise<void>>()

  private appStateSubscription?: NativeEventSubscription
  private lastAppState: AppStateStatus = AppState.currentState
  /** Set by `setSessionActive`, which the audio engine calls as it starts. */
  private sessionActive = false

  constructor(ctx: Context, private readonly config: BackgroundExpoConfig = {}) {
    super(ctx, 'background')
  }

  /**
   * Tell this service that audio is (or is not) holding the process.
   *
   * Called by the shell when it starts and stops the audio session, because
   * only the shell owns that. Without it `canRunInBackground()` would have to
   * guess, and a hardcoded `true` is precisely the lie docs/11 §4.3 forbids.
   */
  setSessionActive(active: boolean): void {
    this.sessionActive = active
  }

  canRunInBackground(): boolean {
    return this.sessionActive
  }

  async acquireWakeLock(reason: string): Promise<Disposable> {
    // Keyed, so two holders do not release each other's lock — and so a leak
    // is visible as a non-empty set rather than as a device that never sleeps.
    const id = `${reason}-${Math.random().toString(36).slice(2, 10)}`
    this.wakeLocks.add(id)
    try {
      await activateKeepAwakeAsync(id)
    } catch {
      // A build without the module linked. The caller's work still runs; it
      // may simply be suspended sooner.
    }

    let released = false
    return () => {
      if (released) return
      released = true
      this.wakeLocks.delete(id)
      try {
        deactivateKeepAwake(id)
      } catch {
        /* nothing to release */
      }
    }
  }

  /**
   * Register deferrable periodic work.
   *
   * The task body is held here and dispatched by a single registered
   * TaskManager entry, because `TaskManager.defineTask` is a *module-level*
   * registration that survives the fiber that made it — defining one per
   * caller would leak a native registration every time a plugin reloaded.
   */
  async schedule(id: string, intervalMinutes: number, task: () => Promise<void>): Promise<Disposable> {
    this.tasks.set(id, task)
    defineDispatcher(this)

    try {
      await BackgroundTask.registerTaskAsync(DISPATCH_TASK, {
        minimumInterval: Math.max(1, Math.round(intervalMinutes)),
      })
    } catch {
      // Background execution refused — Low Power Mode, a restricted user, a
      // simulator. The task simply never runs in the background; a foreground
      // caller can still invoke it.
    }

    return () => {
      this.tasks.delete(id)
      if (this.tasks.size === 0) {
        void BackgroundTask.unregisterTaskAsync(DISPATCH_TASK).catch(() => undefined)
      }
    }
  }

  /** Run every scheduled task. Called by the OS through the dispatcher. */
  async runScheduled(): Promise<void> {
    for (const task of [...this.tasks.values()]) {
      // One failing task must not stop the others: they are unrelated
      // subscribers to the same OS wake-up.
      await task().catch(() => undefined)
    }
  }

  onWillSuspend(cb: () => void | Promise<void>): Disposable {
    this.suspendListeners.add(cb)
    this.appStateSubscription ??= AppState.addEventListener('change', (next) => {
      /*
       * The transition, not the state.
       *
       * `background` is delivered once on the way out; listening for the state
       * would re-fire on every subsequent event while still backgrounded, and
       * the player would checkpoint repeatedly for no reason.
       */
      const leaving = this.lastAppState === 'active' && next !== 'active'
      this.lastAppState = next
      if (!leaving) return
      for (const listener of [...this.suspendListeners]) {
        try {
          void listener()
        } catch {
          /* a checkpoint that throws must not stop the others */
        }
      }
    })

    return () => {
      this.suspendListeners.delete(cb)
      if (this.suspendListeners.size === 0) {
        this.appStateSubscription?.remove()
        this.appStateSubscription = undefined
      }
    }
  }

  async [Service.init]() {
    /*
     * The audio session category, claimed once at boot.
     *
     * This is the half of "playback survives backgrounding" that no amount of
     * JavaScript can substitute for: without `playback`, iOS suspends the
     * process the moment the screen locks (docs/11 §4.13).
     */
    try {
      AudioManager.setAudioSessionOptions({
        iosCategory: this.config.iosCategory ?? 'playback',
        iosMode: 'default',
        iosOptions: ['allowAirPlay', 'allowBluetoothA2DP'],
      })
    } catch {
      /* not linked in this build */
    }

    return () => {
      this.appStateSubscription?.remove()
      this.appStateSubscription = undefined
      this.suspendListeners.clear()
      // A leaked keep-awake is a device that never sleeps with nothing left
      // to release it — the one leak here with a user-visible cost.
      for (const id of this.wakeLocks) {
        try {
          deactivateKeepAwake(id)
        } catch {
          /* already gone */
        }
      }
      this.wakeLocks.clear()
      this.tasks.clear()
      // The module-level dispatcher outlives the fiber — `defineTask` is a
      // registration the OS keeps. Left pointing here, a wake-up after this
      // service was disposed would run tasks belonging to a torn-down graph.
      releaseDispatcher(this)
      void BackgroundTask.unregisterTaskAsync(DISPATCH_TASK).catch(() => undefined)
    }
  }
}

/** One OS task for every caller, because `defineTask` outlives a fiber. */
const DISPATCH_TASK = 'bbebee.background.dispatch'

let dispatcher: BackgroundExpo | undefined
let defined = false

/** Detach a disposed service, so a late OS wake-up reaches nothing. */
function releaseDispatcher(service: BackgroundExpo): void {
  if (dispatcher === service) dispatcher = undefined
}

function defineDispatcher(service: BackgroundExpo): void {
  dispatcher = service
  if (defined) return
  defined = true
  try {
    TaskManager.defineTask(DISPATCH_TASK, async () => {
      await dispatcher?.runScheduled()
      return BackgroundTask.BackgroundTaskResult.Success
    })
  } catch {
    // `defineTask` throws when called after the app has finished starting on
    // some platforms. Losing background work is survivable; a boot is not.
    defined = false
  }
}

export const name = 'core-background-expo'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.background` is usable.
 */
export async function apply(ctx: Context, config: BackgroundExpoConfig = {}) {
  const fiber = await ctx.plugin(BackgroundExpo, config)
  return () => void fiber.dispose()
}

export default { name, apply }
