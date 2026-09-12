/**
 * `ctx.player` — transport, queue, resolution, history.
 *
 * Decides *what* plays. `ctx.dsp` decides how it sounds and `ctx.audio` owns
 * the graph; this plugin touches neither beyond `chainInput`.
 *
 * The load-bearing detail is that it does not know where bytes come from. A
 * track is resolved through the `player/before-resolve` waterfall, whose
 * terminal asks `ctx.sources`. In M1 nothing else hooks it — which is
 * deliberate: it is the control arm for M3's test that playback is identical
 * with and without `plugin-download` (docs/09 §6).
 *
 * See docs/05-audio-playback.md §2 and §5.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { NetworkError, NotFoundError, ProviderError, SourceError } from '@BBeBee/protocol'
import type {
  AudioSourceHandle,
  Disposable,
  PlayNowOptions,
  PlayRecord,
  PlayerService,
  QueueItem,
  RepeatMode,
  StreamHandle,
  StreamPrefs,
  TransportState,
} from '@BBeBee/protocol'
import { QueueModel, type QueueEntry } from './queue.js'
import { PlayerStore } from './store.js'
import { PLAYER_COMMANDS, PLAYER_ROUTES } from './views.js'

export type Transition = 'gapless' | 'crossfade' | 'neither'

export interface PlayerConfig {
  /** `previous()` restarts the current track past this point. */
  previousThresholdMs?: number
  /**
   * Gapless and crossfade are mutually exclusive: doing both produces an
   * audible double-fade, so the setting is a three-way choice (docs/05 §2).
   */
  transition?: Transition
  crossfadeMs?: number
  /** How often position is published, and the state machine re-examined. */
  tickMs?: number
  /** `playback_state` is written no more often than this while playing. */
  saveThrottleMs?: number
  /** Base delay for the network-error backoff. */
  retryBackoffMs?: number
  /**
   * How much of a local file may be decoded into memory.
   *
   * Buffered playback holds *decoded PCM*: a two-hour FLAC is ~2.5 GB at
   * 44.1 kHz stereo, which the phone kills the app for. Past this budget the
   * track streams instead, losing gapless for that one track rather than the
   * process.
   */
  bufferMaxBytes?: number
  /** Consecutive failed tracks before the player stops trying. */
  maxSkipStreak?: number
  /**
   * How long a buffer underrun may last before it becomes an error.
   *
   * `stalled --> error: timeout exceeded` in docs/05 §2. Without a bound the
   * state is absorbing: a stream whose server went away spins a spinner
   * forever, which is the one outcome worse than saying so.
   */
  stallTimeoutMs?: number
  /** Which device wrote `playback_state`, for future sync. */
  deviceId?: string
}

const DEFAULTS = {
  previousThresholdMs: 3000,
  transition: 'gapless' as Transition,
  crossfadeMs: 0,
  tickMs: 1000,
  saveThrottleMs: 5000,
  retryBackoffMs: 500,
  // ~150 MB of source bytes; comfortably a long album, not an audiobook.
  bufferMaxBytes: 150 * 1024 * 1024,
  maxSkipStreak: 10,
  // Long enough that a tunnel or a lift is survived, short enough that a dead
  // connection is reported while the user still remembers pressing play.
  stallTimeoutMs: 30_000,
}

/** Prefetch starts here, per docs/05 §2. */
function prefetchWindowMs(transition: Transition, crossfadeMs: number): number {
  return Math.max(15_000, transition === 'crossfade' ? crossfadeMs + 5000 : 0)
}

interface ActivePlay {
  id: string
  trackUrn: string
  itemId: string
  startedAt: number
  msPlayed: number
  lastPositionMs: number
}

export class Player extends Service implements PlayerService {
  static inject = ['audio', 'sources', 'db']

  private readonly config: Required<PlayerConfig>
  private readonly model = new QueueModel()
  private store!: PlayerStore

  private transport: TransportState = {
    status: 'idle',
    positionMs: 0,
    durationMs: 0,
    bufferedMs: 0,
    volume: 1,
    muted: false,
    repeat: 'off',
    shuffle: false,
  }

  private source?: AudioSourceHandle
  private sourceEnded?: Disposable
  private sourceStalled?: Disposable
  /** Runs while `status === 'stalled'`; firing turns the stall into an error. */
  private stallTimer?: ReturnType<typeof setTimeout>
  private prefetched?: { itemId: string; handle: AudioSourceHandle }
  private prefetchAbort?: AbortController
  private prefetching = false
  private crossfading = false

  /**
   * The scoped context an optional service arrived on.
   *
   * Held rather than re-injected per call: `ctx.inject()` registers a fiber,
   * so calling it on every state change (as an "if available" helper) creates
   * one per publish and leaks every single one. The *context* is held rather
   * than the service object, so the service is still read through `ctx` at
   * call time and an isolated or replaced implementation is honoured.
   */
  private mediaCtx?: Context
  /** The scoped context `ctx.background` arrived on. See `mediaCtx`. */
  private bgCtx?: Context
  /** The scoped context `ctx.device` arrived on. See `mediaCtx`. */
  private deviceCtx?: Context
  /** The scoped context `ctx.codec` arrived on. See `mediaCtx`. */
  private codecCtx?: Context
  /** Held while playing, so the machine does not sleep mid-track (MD-6). */
  private wakeLock?: Disposable
  /** An acquire in flight. The status can change before it lands. */
  private wakeLockPending = false
  private ticker?: ReturnType<typeof setInterval>
  private activePlay?: ActivePlay
  private lastSaveAt = 0
  /** Set when *we* paused for an interruption, cleared by any user action. */
  private pausedByInterruption = false
  private attempts = 0
  /**
   * What the *user* last asked for.
   *
   * Resolving and decoding are async, so "press play, immediately pause" would
   * otherwise finish loading and start playing anyway: `attach` acted on the
   * autoplay flag captured when the load began, not on what was wanted by the
   * time it finished.
   */
  private playIntent = false
  /** Consecutive tracks that failed to start. Reset by any success. */
  private skipStreak = 0
  /** The outgoing source of a crossfade, kept alive until its fade finishes. */
  private fading?: { handle: AudioSourceHandle; timer: ReturnType<typeof setTimeout> }
  private disposed = false

  /**
   * The plugin's own context, captured at construction.
   *
   * ⚠️ Inside a Service method reached through the service proxy (`ctx.player`),
   * Cordis shadows `this.ctx` to be the *caller's* context. If `this.ctx` were
   * used at call time for audio or db calls, capability checks (such as
   * `assertGranted(..., "audio")`) would run against the caller's budget (e.g.
   * UI packages which are granted no capabilities) and throw. Internal player
   * operations must run under `this.ownCtx`. See docs/03 §7 and plugin-sources.
   */
  private readonly ownCtx: Context

  constructor(ctx: Context, config: PlayerConfig = {}) {
    super(ctx, 'player')
    this.ownCtx = ctx
    this.config = {
      ...DEFAULTS,
      deviceId: config.deviceId ?? 'this-device',
      ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)),
    } as Required<PlayerConfig>
  }

  async [Service.init]() {
    this.store = new PlayerStore(this.ownCtx.db, this.config.deviceId)
    await this.restore()
    this.ownCtx.logger.info(
      'player: initialized (currentItem: %s, status: %s, queueSize: %d)',
      this.transport.currentItemId ?? 'none',
      this.transport.status,
      this.model.items.length,
    )

    this.ticker = setInterval(() => void this.refresh(), this.config.tickMs)

    // The whole interruption policy, in one place, over ctx.audio's events —
    // every platform's rules differ, the policy does not (docs/05 §5).
    const offInterruption = this.ownCtx.audio.onInterruption((event) => {
      if (event.type === 'began') {
        this.ownCtx.logger.info('player: audio interruption began, pausing')
        if (isPlayingLike(this.transport.status)) {
          this.pause()
          this.pausedByInterruption = true
        }
        return
      }
      // Resume only if we paused for this, and only if the user has not
      // intervened since.
      if (event.shouldResume && this.pausedByInterruption) {
        this.ownCtx.logger.info('player: audio interruption ended, resuming')
        this.pausedByInterruption = false
        void this.play()
      }
    })

    const offRoute = this.ownCtx.audio.onRouteChange((event) => {
      // Headphones out, Bluetooth gone: pause immediately, and never resume
      // on our own. This one is not configurable — it is the audio behaviour
      // users never forgive.
      if (event.reason === 'device-removed') {
        this.ownCtx.logger.info('player: audio route changed (device-removed), pausing')
        this.pause()
        this.pausedByInterruption = false
      }
    })

    // Optional platform services. The player works without them, which is what
    // makes it testable and what keeps a missing OS surface from being fatal.
    this.ownCtx.inject(['mediaSession'], (scoped) => {
      this.mediaCtx = scoped
      scoped.mediaSession.setSupportedCommands(['play', 'pause', 'next', 'previous', 'seek'])
      this.publishNowPlaying()
      const off = scoped.mediaSession.onCommand((command) => {
        this.ownCtx.logger.debug('player: mediaSession command: %s', command.type)
        switch (command.type) {
          case 'play':
            void this.play()
            break
          case 'pause':
            this.pause()
            break
          case 'stop':
            this.stop()
            break
          case 'next':
            void this.next()
            break
          case 'previous':
            void this.previous()
            break
          case 'seek':
            void this.seek(command.positionMs)
            break
          case 'seek-relative':
            void this.seek(this.transport.positionMs + command.deltaMs)
            break
          default:
            break
        }
      })
      return () => {
        /*
         * Take the OS surface down with us.
         *
         * The lock screen outlives the plugin unless something says
         * otherwise, so a disabled `plugin-player` used to leave a track
         * showing with buttons that no longer did anything — the ghost
         * §4.9 says disabling must not leave. `clear()` only ran from
         * `stop()`, which a disable does not go through.
         *
         * Optional: on a full shutdown the session may already be gone, and
         * a teardown that throws would strand the disposers after it.
         */
        scoped.mediaSession?.clear()
        this.mediaCtx = undefined
        off()
      }
    })

    // Descriptors, not components: the headless plugin says *what* exists and
    // where it belongs, and whichever view package was loaded for this target
    // binds a component to the same id (docs/08 §2). A target with no view
    // still gets the route listed and the commands working.
    // Arrow functions, so `this` is captured lexically: a generator passed to
    // `ctx.effect` is called without a receiver, and aliasing `this` into a
    // local would work but says less about why.
    const togglePlay = () => this.togglePlay()
    const next = () => void this.next()
    const previous = () => void this.previous()

    this.ownCtx.inject(['ui'], (scoped) =>
      scoped.effect(function* () {
        yield scoped.ui.contribute({
          kind: 'route',
          id: PLAYER_ROUTES.nowPlaying,
          path: '/now-playing',
          title: 'Now playing',
          icon: 'play',
          placement: ['tab-bar', 'sidebar'],
          order: 10,
        })
        yield scoped.ui.contribute({
          kind: 'route',
          id: PLAYER_ROUTES.queue,
          path: '/queue',
          title: 'Queue',
          icon: 'list',
          placement: ['tab-bar', 'sidebar'],
          order: 20,
        })
        // Commands work with no view at all: they reach the command palette on
        // desktop and the more-menu on mobile, which is the cheapest way to
        // make a feature reachable on both targets (docs/08 §3).
        yield scoped.ui.contribute({
          kind: 'command',
          id: PLAYER_COMMANDS.togglePlay,
          title: 'Play / pause',
          defaultKeybinding: 'Space',
          run: togglePlay,
        })
        yield scoped.ui.contribute({
          kind: 'command',
          id: PLAYER_COMMANDS.next,
          title: 'Next track',
          run: next,
        })
        yield scoped.ui.contribute({
          kind: 'command',
          id: PLAYER_COMMANDS.previous,
          title: 'Previous track',
          run: previous,
        })
      }, 'player-ui-contributions'),
    )

    this.ownCtx.inject(['background'], (scoped) => {
      this.bgCtx = scoped
      // Checkpoint before the host suspends: on mobile there may be no later.
      const off = scoped.background.onWillSuspend(() => this.persist(true))
      // A status may already be playing — the service can arrive after the
      // first track does.
      this.syncWakeLock()
      return () => {
        this.bgCtx = undefined
        this.dropWakeLock()
        off()
      }
    })

    this.ownCtx.inject(['device'], (scoped) => {
      this.deviceCtx = scoped
      return () => {
        this.deviceCtx = undefined
      }
    })

    this.ownCtx.inject(['codec'], (scoped) => {
      this.codecCtx = scoped
      return () => {
        this.codecCtx = undefined
      }
    })

    const logger = this.ownCtx.logger
    return async () => {
      try {
        logger?.info('player: disposing')
      } catch {
        // teardown logging best-effort
      }
      this.disposed = true
      if (this.ticker) clearInterval(this.ticker)
      offInterruption()
      offRoute()
      this.cancelPrefetch()
      this.clearFading()
      await this.finishPlay({ completed: false, skipped: false })
      this.detachSource()
      this.dropWakeLock()
      await this.persist(true).catch(() => undefined)
    }
  }

  /* ── state ─────────────────────────────────────────────────────────── */

  get state(): Readonly<TransportState> {
    return this.transport
  }

  get queue(): readonly QueueItem[] {
    return this.model.items
  }

  private set(patch: Partial<TransportState>): void {
    const wasPlaying = isPlayingLike(this.transport.status)
    this.transport = { ...this.transport, ...patch }
    if (isPlayingLike(this.transport.status) !== wasPlaying) this.syncWakeLock()
    this.ownCtx.emit('player/state-changed', this.transport)
  }

  /* ── the wake lock ─────────────────────────────────────────────────── */

  /**
   * Hold the machine awake exactly while audio is meant to be coming out.
   *
   * MD-6's other half. Close-to-tray keeps the renderer — and the audio graph
   * — alive when the window goes, but a process that survives a hidden window
   * still stops when the machine sleeps, so "playback survives window-hide"
   * needs both. `ctx.background` is optional, so a build without it plays
   * exactly as before and simply does not hold the lock.
   *
   * ⚠️ `stalled` counts as playing here too. A lock dropped and re-taken on
   * every buffer underrun is a lock the OS sees flapping, and the track is
   * still playing as far as the user and the lock screen are concerned.
   */
  private syncWakeLock(): void {
    if (isPlayingLike(this.transport.status)) void this.takeWakeLock()
    else this.dropWakeLock()
  }

  private async takeWakeLock(): Promise<void> {
    const background = this.bgCtx?.background
    if (!background || this.wakeLock || this.wakeLockPending) return
    this.wakeLockPending = true
    try {
      const lock = await background.acquireWakeLock('playback')
      /*
       * Playback may have stopped while this was in flight — a track that
       * failed to load, or a user who pressed pause immediately. Releasing it
       * on arrival is what stops a paused player from holding the machine
       * awake for ever, which is the failure nobody notices until a laptop
       * runs its battery down in a bag.
       */
      if (this.disposed || !isPlayingLike(this.transport.status)) lock()
      else this.wakeLock = lock
    } catch {
      // A host that refuses a blocker is not a reason to stop playing; the
      // service already reports that case rather than throwing on its own.
    } finally {
      this.wakeLockPending = false
    }
  }

  private dropWakeLock(): void {
    this.wakeLock?.()
    this.wakeLock = undefined
  }

  private emitQueueChanged(): void {
    this.ownCtx.emit('queue/changed', this.model.items)
  }

  /* ── transport ─────────────────────────────────────────────────────── */

  async play(): Promise<void> {
    this.ownCtx.logger.info(
      'player: play requested (status: %s, currentItemId: %s)',
      this.transport.status,
      this.transport.currentItemId ?? 'none',
    )
    this.pausedByInterruption = false
    this.playIntent = true
    if (this.transport.status === 'playing') return

    const current = this.transport.currentItemId
      ? this.model.entry(this.transport.currentItemId)
      : this.model.first()
    if (!current) return

    if (this.source && this.transport.currentItemId === current.item.id) {
      this.source.play()
      this.set({ status: 'playing' })
      this.publishNowPlaying()
      return
    }
    await this.start(current, { positionMs: this.transport.positionMs, autoplay: true })
  }

  pause(): void {
    this.ownCtx.logger.info(
      'player: pause requested (status: %s, currentItemId: %s, positionMs: %d)',
      this.transport.status,
      this.transport.currentItemId ?? 'none',
      this.transport.positionMs,
    )
    this.pausedByInterruption = false
    // Recorded before the early return: a pause during `loading` must still be
    // honoured when the in-flight load lands.
    this.playIntent = false
    // `stalled` counts as playing here: the user pressed pause on a spinner,
    // and refusing them because no audio happens to be coming out would leave
    // the transport claiming to play a track that is going nowhere.
    if (!this.source || !isPlayingLike(this.transport.status)) {
      if (this.transport.status === 'loading') this.set({ status: 'paused' })
      return
    }
    this.clearStall()
    this.source.pause()
    this.set({ status: 'paused', positionMs: this.source.positionMs })
    this.publishNowPlaying()
    void this.persist(true)
  }

  togglePlay(): void {
    this.ownCtx.logger.info('player: togglePlay requested (current status: %s)', this.transport.status)
    if (isPlayingLike(this.transport.status)) this.pause()
    else void this.play()
  }

  stop(): void {
    this.ownCtx.logger.info('player: stop requested')
    this.pausedByInterruption = false
    this.playIntent = false
    void this.finishPlay({ completed: false, skipped: false })
    this.cancelPrefetch()
    this.detachSource()
    // `currentItemId` is cleared too, so a load still in flight recognises
    // that it is no longer wanted rather than matching its own guard.
    this.set({
      status: 'idle',
      currentItemId: undefined,
      trackUrn: undefined,
      positionMs: 0,
      durationMs: 0,
      nowPlaying: undefined,
    })
    this.mediaCtx?.mediaSession.clear()
    void this.persist(true)
  }

  async seek(positionMs: number): Promise<void> {
    const target = Math.max(0, positionMs)
    this.ownCtx.logger.info('player: seek requested to %dms', target)
    if (!this.source) {
      this.set({ positionMs: target })
      return
    }
    const wasPlaying = isPlayingLike(this.transport.status)
    if (wasPlaying) this.source.play(target)
    else {
      this.source.pause()
      this.source.play(target)
      this.source.pause()
    }
    this.set({ positionMs: this.source.positionMs })
    if (this.activePlay) this.activePlay.lastPositionMs = this.source.positionMs
    this.publishNowPlaying()
  }

  async next(): Promise<void> {
    this.ownCtx.logger.info(
      'player: next requested (current: %s, repeat: %s)',
      this.transport.trackUrn ?? 'none',
      this.transport.repeat,
    )
    const entry = this.model.next(this.transport.currentItemId, this.transport.repeat)
    await this.finishPlay({ completed: false, skipped: true })
    if (!entry) {
      this.stop()
      return
    }
    await this.start(entry, { autoplay: this.transport.status !== 'paused' })
  }

  async previous(): Promise<void> {
    this.ownCtx.logger.info(
      'player: previous requested (current: %s, positionMs: %d)',
      this.transport.trackUrn ?? 'none',
      this.transport.positionMs,
    )
    // Past the threshold, "previous" means "start this one again" — which is
    // what every other player does, and what users reach for.
    if (this.source && this.transport.positionMs > this.config.previousThresholdMs) {
      await this.seek(0)
      return
    }
    const entry = this.model.previous(this.transport.currentItemId, this.transport.repeat)
    if (!entry) {
      await this.seek(0)
      return
    }
    await this.finishPlay({ completed: false, skipped: true })
    await this.start(entry, { autoplay: this.transport.status !== 'paused' })
  }

  setVolume(v: number): void {
    const volume = Math.max(0, Math.min(1, v))
    this.ownCtx.logger.debug('player: setVolume to %d', volume)
    this.ownCtx.audio.setVolume(volume)
    this.set({ volume })
    void this.persist()
  }

  setMuted(m: boolean): void {
    this.ownCtx.logger.debug('player: setMuted to %s', m)
    this.ownCtx.audio.setMuted(m)
    this.set({ muted: m })
    void this.persist()
  }

  setRepeat(mode: RepeatMode): void {
    this.ownCtx.logger.info('player: setRepeat to %s', mode)
    this.set({ repeat: mode })
    void this.persist(true)
  }

  setShuffle(on: boolean): void {
    this.ownCtx.logger.info('player: setShuffle to %s', on)
    this.model.setShuffle(on)
    this.set({ shuffle: on })
    this.emitQueueChanged()
    void this.persist(true)
  }

  /* ── queue ─────────────────────────────────────────────────────────── */

  async playNow(urns: string[], opts: PlayNowOptions = {}): Promise<void> {
    this.ownCtx.logger.info('player: playNow with %d track(s), first: %s', urns.length, urns[0] ?? 'none')
    const accepted = this.beforeEnqueue(urns)
    if (accepted.length === 0) return

    const items = accepted.map((urn) => this.newItem(urn, 'user', opts.context))
    this.cancelPrefetch()
    this.model.replace(items)
    await this.store.replaceQueue(this.model.all)
    this.emitQueueChanged()

    this.playIntent = true
    const startAt = Math.max(0, Math.min(items.length - 1, opts.startIndex ?? 0))
    const entry = this.model.entry(this.model.order()[startAt]!)
    if (entry) await this.start(entry, { autoplay: true })
  }

  enqueueNext(urns: string[]): void {
    const items = this.beforeEnqueue(urns).map((urn) => this.newItem(urn, 'user'))
    if (items.length === 0) return
    this.ownCtx.logger.info('player: enqueueNext with %d track(s)', items.length)
    const added = this.model.insertAfter(this.transport.currentItemId, items)
    void this.store.insertQueue(added)
    this.cancelPrefetch()
    this.emitQueueChanged()
  }

  enqueueLast(urns: string[]): void {
    const items = this.beforeEnqueue(urns).map((urn) => this.newItem(urn, 'user'))
    if (items.length === 0) return
    this.ownCtx.logger.info('player: enqueueLast with %d track(s)', items.length)
    const added = this.model.append(items)
    void this.store.insertQueue(added)
    this.emitQueueChanged()
  }

  removeItems(ids: string[]): void {
    this.ownCtx.logger.info('player: removeItems with %d item(s)', ids.length)
    const removed = this.model.remove(ids)
    if (removed.length === 0) return
    void this.store.removeQueue(removed)
    if (this.transport.currentItemId && removed.includes(this.transport.currentItemId)) {
      // The playing item was removed: stop rather than silently jumping.
      this.stop()
    }
    this.cancelPrefetch()
    this.emitQueueChanged()
  }

  moveItem(id: string, toIndex: number): void {
    this.ownCtx.logger.info('player: moveItem %s to index %d', id, toIndex)
    const moved = this.model.move(id, toIndex)
    if (!moved) return
    // One row, because the position is a fractional index (docs/07 §4.6).
    void this.store.moveQueueItem(moved)
    this.cancelPrefetch()
    this.emitQueueChanged()
  }

  clearQueue(): void {
    this.ownCtx.logger.info('player: clearQueue')
    this.model.clear()
    void this.store.replaceQueue([])
    this.cancelPrefetch()
    this.detachSource()
    this.set({ status: 'idle', currentItemId: undefined, trackUrn: undefined, positionMs: 0, durationMs: 0, nowPlaying: undefined })
    this.emitQueueChanged()
  }

  /** The upcoming order, which under shuffle is the permutation, not the rows. */
  upcoming(): QueueItem[] {
    const order = this.model.order()
    const at = this.transport.currentItemId ? order.indexOf(this.transport.currentItemId) : -1
    return order
      .slice(at + 1)
      .map((id) => this.model.entry(id)?.item)
      .filter((item): item is QueueItem => item !== undefined)
  }

  private beforeEnqueue(urns: string[]): string[] {
    // A waterfall so a plugin can filter or expand what is about to be queued
    // (a radio plugin, a "skip explicit" policy) without the player knowing.
    //
    // Listeners rewrite by mutating the array in place — `next(other)` is
    // silently ignored by Cordis, so the signature takes no arguments and the
    // kernel pins that behaviour (docs/07 §5).
    const accepted = [...urns]
    this.ownCtx.waterfall('player/before-enqueue', accepted, () => {})
    return accepted
  }

  private newItem(
    trackUrn: string,
    addedBy: QueueItem['addedBy'],
    context?: QueueItem['sourceContext'],
  ): QueueItem {
    return {
      id: `q_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      trackUrn,
      addedBy,
      addedAt: Date.now(),
      ...(context ? { sourceContext: context } : {}),
    }
  }

  /* ── loading and resolution ────────────────────────────────────────── */

  private async start(
    entry: QueueEntry,
    opts: { positionMs?: number; autoplay: boolean },
  ): Promise<void> {
    this.ownCtx.logger.info(
      'player: starting track %s (itemId: %s, autoplay: %s, positionMs: %d)',
      entry.item.trackUrn,
      entry.item.id,
      opts.autoplay,
      opts.positionMs ?? 0,
    )
    const previousUrn = this.transport.trackUrn
    await this.finishPlay({ completed: false, skipped: true })
    this.detachSource()

    this.set({
      status: 'loading',
      currentItemId: entry.item.id,
      trackUrn: entry.item.trackUrn,
      positionMs: opts.positionMs ?? 0,
      durationMs: 0,
      bufferedMs: 0,
      error: undefined,
    })
    this.ownCtx.emit('player/track-changed', entry.item.trackUrn, previousUrn)
    this.publishNowPlaying()

    // A prefetched buffer for exactly this item is the gapless path: no
    // resolve, no decode, no I/O between the two tracks.
    const ready = this.takePrefetched(entry.item.id)
    if (ready) {
      this.ownCtx.logger.info('player: using prefetched source for %s', entry.item.trackUrn)
      this.attach(ready, entry, opts)
      return
    }

    try {
      const handle = await this.resolveStream(entry.item.trackUrn)
      if (this.disposed || this.transport.currentItemId !== entry.item.id) return
      const source = await this.load(handle)
      if (this.disposed || this.transport.currentItemId !== entry.item.id) {
        source.dispose()
        return
      }
      this.attempts = 0
      this.attach(source, entry, opts)
    } catch (error) {
      await this.handleError(error, entry)
    }
  }

  private attach(
    source: AudioSourceHandle,
    entry: QueueEntry,
    opts: { positionMs?: number; autoplay: boolean },
  ): void {
    this.ownCtx.logger.info(
      'player: attached source for %s (durationMs: %d, willPlay: %s)',
      entry.item.trackUrn,
      source.durationMs,
      opts.autoplay && this.playIntent,
    )
    this.source = source
    source.node.connect(this.ownCtx.audio.chainInput)
    this.sourceEnded = source.onEnded(() => void this.onEnded())
    this.sourceStalled = source.onStalled((stalled) => this.onStalled(stalled))

    // A track that started is a track that worked.
    this.skipStreak = 0

    const positionMs = opts.positionMs ?? 0
    if (opts.autoplay && this.playIntent) {
      source.play(positionMs)
      this.set({ status: 'playing', durationMs: source.durationMs, positionMs })
      this.beginPlay(entry, positionMs)
    } else {
      // Either this was a deliberate load-without-play, or the user paused or
      // stopped while the load was in flight. Their intent wins.
      this.set({ status: 'paused', durationMs: source.durationMs, positionMs })
    }
    this.publishNowPlaying()
    void this.persist(true)
  }

  private async load(handle: StreamHandle): Promise<AudioSourceHandle> {
    return this.ownCtx.audio.load(handle.target, {
      strategy: this.strategyFor(handle),
      ...(handle.headers ? { headers: handle.headers } : {}),
      onBuffered: (seconds) => this.set({ bufferedMs: Math.round(seconds * 1000) }),
    })
  }

  /**
   * Buffered or streamed.
   *
   * Local files decode fully — that is what makes a gapless handoff possible —
   * but only within a budget: decoded PCM is roughly ten times the file, so an
   * unbounded rule turns a long audiobook into a 2.5 GB allocation and an
   * out-of-memory kill on a phone. Past the budget the track streams and loses
   * gapless, which is the right thing to lose.
   */
  private strategyFor(handle: StreamHandle): 'buffer' | 'stream' {
    if (handle.kind !== 'local') return 'stream'
    const bytes = handle.byteLength
    if (bytes !== undefined && bytes > this.config.bufferMaxBytes) return 'stream'
    return 'buffer'
  }

  /**
   * URN → bytes, through the waterfall.
   *
   * The terminal is the only part that knows about providers. Everything else
   * — a downloaded file, a linked URN on another provider — arrives as a
   * listener that never has to touch this method.
   */
  private async resolveStream(urn: string): Promise<StreamHandle> {
    const prefs = await this.streamPrefs()
    const terminal = async (): Promise<StreamHandle> => {
      const provider = this.ownCtx.sources.forUrn(urn)
      if (!provider) throw new NotFoundError(`no provider for ${urn}`)
      const { id } = parseUrnId(urn)
      return provider.resolveStream(id, prefs)
    }
    return this.ownCtx.waterfall('player/before-resolve', urn, prefs, terminal)
  }

  private async streamPrefs(): Promise<StreamPrefs> {
    let saveData = false
    let acceptFormats: string[] = []

    // Both are optional in M1; their absence degrades the request, never the
    // playback.
    const device = this.deviceCtx?.device
    if (device) {
      try {
        saveData = (await device.network()).metered
      } catch {
        saveData = false
      }
    }
    const codec = this.codecCtx?.codec
    if (codec) {
      try {
        acceptFormats = codec.supportedFormats()
      } catch {
        acceptFormats = []
      }
    }
    return { quality: 'lossless', saveData, acceptFormats }
  }

  /* ── the clock ─────────────────────────────────────────────────────── */

  /**
   * Recompute position and everything driven by it.
   *
   * The ticker calls this at 1 Hz — `player/position` at 60 Hz would dominate
   * the event bus for no benefit, and the UI interpolates between ticks
   * (docs/07 §5). Public because a shell wants it on regaining focus, and
   * because tests drive it directly rather than waiting on wall-clock time.
   */
  async refresh(): Promise<void> {
    if (this.disposed || !this.source) return
    const positionMs = this.source.positionMs
    const durationMs = this.source.durationMs || this.transport.durationMs

    if (this.transport.status === 'playing') {
      if (this.activePlay) {
        this.activePlay.msPlayed += Math.max(0, positionMs - this.activePlay.lastPositionMs)
        this.activePlay.lastPositionMs = positionMs
      }
      this.set({ positionMs, durationMs })
      this.ownCtx.emit('player/position', positionMs, durationMs)
      this.publishPosition(positionMs)
      await this.maybePrefetch(positionMs, durationMs)
      await this.maybeCrossfade(positionMs, durationMs)
      await this.persist()
    }
  }

  /* ── stalls ────────────────────────────────────────────────────────── */

  /**
   * A buffer underrun, and its recovery.
   *
   * `stalled` is deliberately not `paused`: the user did not ask for this, so
   * the UI shows a spinner rather than a play button and `ctx.mediaSession`
   * goes on reporting *playing*, which is what stops the lock screen
   * flickering every time a train goes into a tunnel (docs/05 §2).
   *
   * Only a track that was actually playing can stall. A `waiting` that arrives
   * while the user has it paused — a media element still filling its buffer,
   * say — is not a stall in any sense the transport cares about.
   */
  private onStalled(stalled: boolean): void {
    this.ownCtx.logger.warn('player: playback %s', stalled ? 'stalled' : 'recovered from stall')
    if (stalled) {
      if (this.transport.status !== 'playing') return
      this.set({ status: 'stalled' })
      this.publishNowPlaying()
      this.stallTimer = setTimeout(() => {
        this.stallTimer = undefined
        if (this.transport.status !== 'stalled') return
        // Retryable: the queue is intact and pressing play is all it takes,
        // which is the same shape as the out-of-attempts network failure.
        this.fail(new NetworkError('playback stalled and did not recover'), true)
      }, this.config.stallTimeoutMs)
      return
    }

    this.clearStall()
    if (this.transport.status !== 'stalled') return
    this.set({ status: 'playing' })
    this.publishNowPlaying()
  }

  private clearStall(): void {
    if (this.stallTimer === undefined) return
    clearTimeout(this.stallTimer)
    this.stallTimer = undefined
  }

  private async maybePrefetch(positionMs: number, durationMs: number): Promise<void> {
    if (this.config.transition === 'neither' || this.prefetching || this.prefetched) return
    if (!durationMs) return
    const window = prefetchWindowMs(this.config.transition, this.config.crossfadeMs)
    if (durationMs - positionMs > window) return

    const next = this.model.next(this.transport.currentItemId, this.transport.repeat)
    if (!next || next.item.id === this.transport.currentItemId) return

    this.prefetching = true
    const abort = new AbortController()
    this.prefetchAbort = abort
    try {
      const handle = await this.resolveStream(next.item.trackUrn)
      if (abort.signal.aborted) return
      // Buffered, because a handoff with no gap cannot wait on a network read.
      // A track too large to buffer is simply not prefetched: it will stream
      // when its turn comes, and gapless was never available for it anyway.
      if (this.strategyFor(handle) !== 'buffer') return
      const source = await this.ownCtx.audio.load(handle.target, {
        strategy: 'buffer',
        ...(handle.headers ? { headers: handle.headers } : {}),
        signal: abort.signal,
      })
      if (abort.signal.aborted) {
        source.dispose()
        return
      }
      this.prefetched = { itemId: next.item.id, handle: source }
      this.ownCtx.logger.debug('player: prefetched %s', next.item.trackUrn)
    } catch {
      // A prefetch that fails is not an error the user should see: the track
      // is loaded again, normally, when it is actually its turn.
    } finally {
      this.prefetching = false
      if (this.prefetchAbort === abort) this.prefetchAbort = undefined
    }
  }

  private async maybeCrossfade(positionMs: number, durationMs: number): Promise<void> {
    if (this.config.transition !== 'crossfade' || this.config.crossfadeMs <= 0) return
    if (this.crossfading || !durationMs) return
    if (durationMs - positionMs > this.config.crossfadeMs) return

    const next = this.model.next(this.transport.currentItemId, this.transport.repeat)
    if (!next) return
    const incoming = this.takePrefetched(next.item.id)
    if (!incoming) return

    this.crossfading = true
    this.ownCtx.logger.info('player: crossfading to %s (%dms)', next.item.trackUrn, this.config.crossfadeMs)
    const outgoing = this.source
    const seconds = this.config.crossfadeMs / 1000

    // Equal-power in spirit: the outgoing node fades out while the incoming
    // one fades in over the same window, so the sum stays roughly constant.
    ramp(outgoing?.node, 1, 0, seconds, this.ownCtx.audio.context.currentTime)
    incoming.node.connect(this.ownCtx.audio.chainInput)
    ramp(incoming.node, 0, 1, seconds, this.ownCtx.audio.context.currentTime)

    await this.finishPlay({ completed: true, skipped: false })

    // The outgoing source is kept alive for the length of its fade. Disposing
    // it here — as `detachSource` would — stops it instantly, so the ramp
    // never sounds and a "crossfade" is only ever a fade-in.
    this.clearStall()
    this.sourceEnded?.()
    this.sourceEnded = undefined
    this.sourceStalled?.()
    this.sourceStalled = undefined
    this.source = undefined
    if (outgoing) this.fadeOut(outgoing, this.config.crossfadeMs)

    // The identity moves with the audio. `attach` only wires a source; the
    // track a crossfade hands over to is a *track change*, and without this
    // the transport, the lock screen, the history and `next()` all went on
    // believing the previous track was still playing.
    const previousUrn = this.transport.trackUrn
    this.set({
      currentItemId: next.item.id,
      trackUrn: next.item.trackUrn,
      positionMs: 0,
      bufferedMs: 0,
      error: undefined,
    })
    this.ownCtx.emit('player/track-changed', next.item.trackUrn, previousUrn)

    this.attach(incoming, next, { autoplay: true })
    this.crossfading = false
  }

  private fadeOut(handle: AudioSourceHandle, ms: number): void {
    this.clearFading()
    const timer = setTimeout(() => {
      this.fading = undefined
      handle.dispose()
    }, ms)
    this.fading = { handle, timer }
  }

  private clearFading(): void {
    if (!this.fading) return
    clearTimeout(this.fading.timer)
    this.fading.handle.dispose()
    this.fading = undefined
  }

  private takePrefetched(itemId: string): AudioSourceHandle | undefined {
    if (!this.prefetched) return undefined
    if (this.prefetched.itemId !== itemId) return undefined
    const { handle } = this.prefetched
    this.prefetched = undefined
    return handle
  }

  private cancelPrefetch(): void {
    this.prefetchAbort?.abort()
    this.prefetchAbort = undefined
    this.prefetched?.handle.dispose()
    this.prefetched = undefined
  }

  private async onEnded(): Promise<void> {
    if (this.disposed) return
    this.ownCtx.logger.info('player: track ended %s', this.transport.trackUrn ?? 'unknown')
    await this.finishPlay({ completed: true, skipped: false })

    const next = this.model.next(this.transport.currentItemId, this.transport.repeat)
    if (!next) {
      this.detachSource()
      this.set({ status: 'idle', positionMs: 0 })
      void this.persist(true)
      return
    }
    await this.start(next, { autoplay: true })
  }

  /* ── history ───────────────────────────────────────────────────────── */

  private beginPlay(entry: QueueEntry, positionMs: number): void {
    this.activePlay = {
      id: `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      trackUrn: entry.item.trackUrn,
      itemId: entry.item.id,
      startedAt: Date.now(),
      msPlayed: 0,
      lastPositionMs: positionMs,
    }
  }

  private async finishPlay(outcome: { completed: boolean; skipped: boolean }): Promise<void> {
    const play = this.activePlay
    this.activePlay = undefined
    if (!play) return

    if (this.source && this.transport.status === 'playing') {
      play.msPlayed += Math.max(0, this.source.positionMs - play.lastPositionMs)
    }

    const record: PlayRecord = {
      id: play.id,
      trackUrn: play.trackUrn,
      startedAt: play.startedAt,
      endedAt: Date.now(),
      msPlayed: play.msPlayed,
      completed: outcome.completed,
      skipped: outcome.skipped,
      deviceId: this.config.deviceId,
      ...(this.model.entry(play.itemId)?.item.sourceContext
        ? { source: this.model.entry(play.itemId)!.item.sourceContext }
        : {}),
    }

    // History and the derived stats land in one transaction, so "most played"
    // can be a single indexed read without ever disagreeing with the record.
    await this.store.recordPlay(record).catch((error: unknown) => {
      this.ownCtx.logger.warn(`player: could not record play: ${String(error)}`)
    })
    // Scrobblers, stats and anything else run in parallel; one failing does
    // not block the others (docs/07 §5).
    await this.ownCtx.parallel('player/track-completed', record).catch(() => undefined)
  }

  /* ── errors ────────────────────────────────────────────────────────── */

  private async handleError(error: unknown, entry: QueueEntry): Promise<void> {
    const sourceError =
      error instanceof SourceError
        ? error
        : new ProviderError(error instanceof Error ? error.message : String(error))

    this.ownCtx.logger.error(
      'player: error playing %s: %s (code: %s)',
      entry.item.trackUrn,
      sourceError.message,
      sourceError.code,
    )
    this.ownCtx.emit('player/error', sourceError, entry.item.trackUrn)

    switch (sourceError.code) {
      case 'auth':
        // Stop and let the source plugin re-authenticate. The queue survives.
        await this.ownCtx.serial('source/auth-expired', instanceOf(entry.item.trackUrn))
        this.fail(sourceError, false)
        return

      case 'rate-limit': {
        const retryAfterMs = (sourceError as { retryAfterMs?: number }).retryAfterMs ?? 1000
        if (this.attempts === 0) {
          this.attempts++
          await delay(retryAfterMs)
          if (this.transport.currentItemId !== entry.item.id) return
          await this.start(entry, { autoplay: true })
          return
        }
        this.attempts = 0
        await this.skip(entry)
        return
      }

      case 'network': {
        if (this.attempts < 3) {
          this.attempts++
          await delay(this.config.retryBackoffMs * 2 ** (this.attempts - 1))
          if (this.transport.currentItemId !== entry.item.id) return
          await this.start(entry, { autoplay: true })
          return
        }
        // Out of attempts: pause with the queue intact so pressing play is all
        // it takes once connectivity is back.
        this.attempts = 0
        this.fail(sourceError, true)
        return
      }

      case 'not-found':
        await this.store.markUnavailable(entry.item.trackUrn).catch(() => undefined)
        await this.skip(entry)
        return

      // `unavailable` is where plugin-source-failover hooks the resolve
      // waterfall at M2; with nothing hooked, the honest response is to skip.
      case 'unavailable':
      case 'provider':
      default:
        await this.skip(entry)
    }
  }

  private fail(error: SourceError, retryable: boolean): void {
    this.ownCtx.logger.error('player: playback failed: %s (retryable: %s)', error.message, retryable)
    this.detachSource()
    this.set({
      status: 'error',
      error: { code: error.code, message: error.message, retryable },
    })
  }

  private async skip(entry: QueueEntry): Promise<void> {
    this.ownCtx.logger.warn(
      'player: skipping track %s (streak: %d)',
      entry.item.trackUrn,
      this.skipStreak + 1,
    )
    // Under repeat-all the queue never runs out, so a queue in which every
    // track fails would skip forever — an event storm, a write per track, and
    // a UI stuck on "skipping" until the battery goes. Give up after a run of
    // failures instead; any track that starts resets the count.
    if (++this.skipStreak >= this.config.maxSkipStreak) {
      this.skipStreak = 0
      this.fail(
        new ProviderError(
          `${this.config.maxSkipStreak} tracks in a row failed to play; stopping`,
        ),
        true,
      )
      return
    }

    const next = this.model.next(entry.item.id, this.transport.repeat)
    if (!next || next.item.id === entry.item.id) {
      this.set({ status: 'idle' })
      return
    }
    await this.start(next, { autoplay: true })
  }

  /* ── media session ─────────────────────────────────────────────────── */

  private publishNowPlaying(): void {
    const urn = this.transport.trackUrn
    const session = this.mediaCtx?.mediaSession
    if (!urn) {
      if (this.transport.nowPlaying) {
        this.set({ nowPlaying: undefined })
      }
      session?.clear()
      return
    }

    void this.store
      .nowPlaying(urn)
      .then((meta) => {
        if (this.transport.trackUrn === urn && meta) {
          this.set({ nowPlaying: meta })
        }
        if (session) {
          session.update({
            title: meta?.title ?? urn,
            ...(meta?.artist ? { artist: meta.artist } : {}),
            ...(meta?.album ? { album: meta.album } : {}),
            ...(meta?.artworkUri ? { artworkUri: meta.artworkUri } : {}),
            durationMs: this.transport.durationMs,
            positionMs: this.transport.positionMs,
          })
        }
      })
      .catch(() => undefined)

    if (session) {
      // `stalled` keeps reporting `playing`, so the lock screen does not
      // flicker on a buffer underrun (docs/05 §2).
      session.setPlaybackState(
        this.transport.status === 'playing' || this.transport.status === 'stalled'
          ? 'playing'
          : this.transport.status === 'paused'
            ? 'paused'
            : 'stopped',
      )
    }
  }

  private publishPosition(positionMs: number): void {
    this.mediaCtx?.mediaSession.update({
      title: this.transport.trackUrn ?? '',
      durationMs: this.transport.durationMs,
      positionMs,
    })
  }

  /* ── persistence ───────────────────────────────────────────────────── */

  private async persist(immediate = false): Promise<void> {
    const now = Date.now()
    if (!immediate && now - this.lastSaveAt < this.config.saveThrottleMs) return
    this.lastSaveAt = now
    await this.store
      .saveState({
        currentItemId: this.transport.currentItemId,
        positionMs: this.transport.positionMs,
        repeat: this.transport.repeat,
        shuffle: this.model.shuffle,
        shuffleSeed: this.model.shuffleSeed,
        volume: this.transport.volume,
        muted: this.transport.muted,
      })
      .catch((error: unknown) => {
        this.ownCtx.logger.warn(`player: could not save playback state: ${String(error)}`)
      })
  }

  /**
   * Restore the queue and position — and do **not** start playing.
   *
   * Resuming into playback on launch is startling, particularly on a phone
   * that just came out of a pocket (docs/05 §2).
   */
  private async restore(): Promise<void> {
    const [entries, state] = await Promise.all([this.store.loadQueue(), this.store.loadState()])
    this.model.load(entries, { shuffle: state?.shuffle ?? false, seed: state?.shuffleSeed ?? 1 })

    if (state) {
      this.transport = {
        ...this.transport,
        repeat: state.repeat,
        shuffle: state.shuffle,
        volume: state.volume,
        muted: state.muted,
      }
      this.ownCtx.audio.setVolume(state.volume)
      this.ownCtx.audio.setMuted(state.muted)
    }

    const current = state?.currentItemId ? this.model.entry(state.currentItemId) : undefined
    if (current) {
      this.transport = {
        ...this.transport,
        status: 'paused',
        currentItemId: current.item.id,
        trackUrn: current.item.trackUrn,
        positionMs: state?.positionMs ?? 0,
      }
    }
    if (entries.length > 0) this.emitQueueChanged()
    this.ownCtx.logger.info(
      'player: restored state (entries: %d, currentItem: %s, positionMs: %d)',
      entries.length,
      current?.item.trackUrn ?? 'none',
      state?.positionMs ?? 0,
    )
  }

  /* ── teardown ──────────────────────────────────────────────────────── */

  private detachSource(): void {
    this.clearStall()
    this.sourceEnded?.()
    this.sourceEnded = undefined
    this.sourceStalled?.()
    this.sourceStalled = undefined
    this.source?.dispose()
    this.source = undefined
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

/**
 * Statuses in which audio is meant to be coming out.
 *
 * `stalled` is one of them: it is a starved `playing`, not a `paused`, so
 * pause, seek, an interruption and a route change all treat it as playing.
 * `plugin-player`'s hooks export the same predicate for the UI, and the two
 * agreeing is the whole point of docs/05 §2's distinction.
 */
function isPlayingLike(status: TransportState['status']): boolean {
  return status === 'playing' || status === 'stalled'
}

/** Ramp a handle's own gain, where the platform gives us one to ramp. */
function ramp(node: AudioNode | undefined, from: number, to: number, seconds: number, now: number): void {
  const gain = (node as { gain?: AudioParam } | undefined)?.gain
  if (!gain) return
  gain.setValueAtTime?.(from, now)
  if (gain.linearRampToValueAtTime) gain.linearRampToValueAtTime(to, now + seconds)
  else gain.value = to
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/** The provider-local id inside a URN, without importing the parser twice. */
function parseUrnId(urn: string): { sourceId: string; id: string } {
  const parts = urn.split(':')
  return { sourceId: parts[1] ?? '', id: parts.slice(3).join(':') }
}

function instanceOf(urn: string): string {
  return parseUrnId(urn).sourceId
}

export const name = 'plugin-player'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.player` is usable.
 */
export async function apply(ctx: Context, config: PlayerConfig = {}) {
  ctx.logger.info('plugin-player: loaded')
  const fiber = await ctx.plugin(Player, config)
  return () => void fiber.dispose()
}

export default { name, apply }
export { QueueModel } from './queue.js'
export { permute } from '@BBeBee/toolkit'
export { PlayerStore } from './store.js'
export { PLAYER_COMMANDS, PLAYER_ROUTES, PLAYER_VIEWS } from './views.js'
