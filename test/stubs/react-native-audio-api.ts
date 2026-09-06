/**
 * A stand-in for `react-native-audio-api` under Vitest.
 *
 * The mobile core packages import it at module scope, which is right for
 * Metro and impossible in Node. Aliasing it to this file is what lets the
 * parts of those packages that are *logic* — command mapping, control
 * enabling, the artwork policy — run in the same suite as everything else,
 * instead of being verified only by reading them.
 *
 * Every export here throws or no-ops rather than pretending to work: a test
 * that reaches the native surface should fail loudly, and the packages that
 * are meant to be tested take their surface as an injectable seam.
 */

const unavailable = (what: string) => () => {
  throw new Error(`react-native-audio-api: ${what} is not available under test`)
}

export const PlaybackNotificationManager = {
  show: unavailable('PlaybackNotificationManager.show'),
  hide: unavailable('PlaybackNotificationManager.hide'),
  enableControl: unavailable('PlaybackNotificationManager.enableControl'),
  isActive: unavailable('PlaybackNotificationManager.isActive'),
  addEventListener: () => undefined,
}

export const AudioManager = {
  setAudioSessionOptions: () => {},
  setAudioSessionActivity: async () => {},
  observeAudioInterruptions: () => {},
  addSystemEventListener: () => undefined,
  getDevicesInfo: async () => ({
    availableInputs: [],
    availableOutputs: [],
    currentInputs: [],
    currentOutputs: [],
  }),
}

export const decodeAudioData = unavailable('decodeAudioData')

export class AudioContext {
  constructor() {
    throw new Error('react-native-audio-api: AudioContext is not available under test')
  }
}
