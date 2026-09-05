/**
 * `ctx.mediaSession` conformance.
 *
 * What is checkable without an OS is the *round trip*: metadata in, playback
 * state in, commands out, and a `clear()` that genuinely removes the surface.
 * Whether the lock screen actually draws the artwork is a device smoke test
 * (docs/11 §6, criterion 3) — but everything below is what a wrong
 * implementation gets wrong first, and it is the same on both platforms.
 *
 * The subject supplies a way to *simulate* an OS command, because the whole
 * point of the service is that a lock-screen press reaches `ctx.player`.
 */

import type { MediaSessionService, NowPlaying, TransportCommand } from '../services/platform.js'
import { assert, assertEqual, type ConformanceSuite } from './harness.js'

export interface MediaSessionSubject {
  service: MediaSessionService
  /** What the OS surface currently shows, or `undefined` after `clear()`. */
  published(): { nowPlaying?: NowPlaying; state?: string; commands?: string[] } | undefined
  /** Drive a command as the OS would. */
  press(command: TransportCommand): void
}

const track: NowPlaying = {
  title: 'Jóga',
  artist: 'Björk',
  album: 'Homogenic',
  durationMs: 303_000,
  positionMs: 1000,
}

export const mediaSessionConformance: ConformanceSuite<MediaSessionSubject> = {
  service: 'mediaSession',
  checks: [
    {
      name: 'publishes metadata to the OS surface',
      because: 'the lock screen showing the wrong track is the most visible bug there is',
      async run({ service, published }) {
        service.update(track)
        const shown = published()
        assert(shown?.nowPlaying !== undefined, 'nothing was published')
        assertEqual(shown.nowPlaying.title, 'Jóga', 'title')
        assertEqual(shown.nowPlaying.artist, 'Björk', 'artist')
      },
    },
    {
      name: 'updates metadata in place rather than stacking sessions',
      because: 'a second session leaves the previous track on the lock screen forever',
      async run({ service, published }) {
        service.update(track)
        service.update({ ...track, title: 'Bachelorette' })
        assertEqual(published()?.nowPlaying?.title, 'Bachelorette', 'title after update')
      },
    },
    {
      name: 'reflects playback state',
      because: 'the OS draws play or pause from this, not from whether audio is audible',
      async run({ service, published }) {
        service.update(track)
        service.setPlaybackState('playing')
        assertEqual(published()?.state, 'playing', 'state')
        service.setPlaybackState('paused')
        assertEqual(published()?.state, 'paused', 'state')
      },
    },
    {
      name: 'setSupportedCommands changes which buttons the surface offers',
      because:
        'a button the app cannot honour is worse than a missing one — docs/11 §4.4',
      async run({ service, published }) {
        service.update(track)
        service.setSupportedCommands(['play', 'pause'])
        assertEqual(published()?.commands?.slice().sort(), ['pause', 'play'], 'commands')
        service.setSupportedCommands(['play', 'pause', 'next', 'previous'])
        assertEqual(
          published()?.commands?.slice().sort(),
          ['next', 'pause', 'play', 'previous'],
          'commands after widening',
        )
      },
    },
    {
      name: 'a command from the OS reaches the listener',
      because: 'this is the entire purpose of the service',
      async run({ service, press }) {
        const seen: TransportCommand[] = []
        const off = service.onCommand((command) => void seen.push(command))
        service.setSupportedCommands(['play', 'pause', 'next', 'seek'])

        press({ type: 'play' })
        press({ type: 'next' })
        press({ type: 'seek', positionMs: 42_000 })
        off()

        assertEqual(seen.length, 3, 'commands received')
        assertEqual(seen[0], { type: 'play' }, 'first command')
        assertEqual(seen[2], { type: 'seek', positionMs: 42_000 }, 'seek carries its position')
      },
    },
    {
      name: 'a disposed listener stops receiving commands',
      because: 'a leaked listener drives a player that no longer exists',
      async run({ service, press }) {
        let count = 0
        const off = service.onCommand(() => void count++)
        press({ type: 'play' })
        off()
        press({ type: 'play' })
        assertEqual(count, 1, 'commands after disposal')
      },
    },
    {
      name: 'supports several listeners independently',
      because: 'the player is not guaranteed to be the only subscriber',
      async run({ service, press }) {
        let a = 0
        let b = 0
        const offA = service.onCommand(() => void a++)
        const offB = service.onCommand(() => void b++)
        press({ type: 'pause' })
        offA()
        press({ type: 'pause' })
        offB()
        assertEqual([a, b], [1, 2], 'per-listener counts')
      },
    },
    {
      name: 'clear() removes the surface',
      because:
        'a disabled player must leave no ghost lock screen — the check in docs/11 §4.4',
      async run({ service, published }) {
        service.update(track)
        service.setPlaybackState('playing')
        service.clear()
        assert(published() === undefined, 'the OS surface survived clear()')
      },
    },
    {
      name: 'stopping keeps the surface; only clear() removes it',
      because:
        'stopped is a transport state and clear() is a separate member — an implementation that ' +
        'conflates them loses the lock screen when a queue runs out, and only on its platform',
      async run({ service, published }) {
        service.update(track)
        service.setPlaybackState('playing')
        service.setPlaybackState('stopped')

        // The two implementations disagreed about this precisely because
        // nothing asked. Desktop set the session to `none` and kept the track;
        // mobile hid the notification and dropped it, so pressing play after a
        // queue ended showed an empty lock screen on one platform and the
        // track on the other.
        const shown = published()
        assert(shown !== undefined, 'stopping removed the surface — that is clear()’s job')
        assertEqual(shown.nowPlaying?.title, 'Jóga', 'the track survives a stop')
      },
    },
    {
      name: 'survives update() before any playback state is set',
      because: 'the player publishes metadata first and state a moment later',
      async run({ service, published }) {
        service.update(track)
        assert(published()?.nowPlaying !== undefined, 'metadata needs no prior state')
      },
    },
    {
      name: 'tolerates a track with only a title',
      because: 'a URL source has no tags, and the surface must still appear',
      async run({ service, published }) {
        service.update({ title: 'stream.mp3' })
        assertEqual(published()?.nowPlaying?.title, 'stream.mp3', 'title-only track')
      },
    },
  ],
}
