/**
 * The view ids `plugin-player` contributes.
 *
 * Shared by both view packages so a descriptor and the component that fills
 * it cannot drift apart: the headless plugin contributes the descriptor, each
 * kit binds a component to the same id, and the shell resolves whichever one
 * was loaded (docs/08 3).
 */

export const PLAYER_VIEWS = {
  /** The full-screen player on mobile; the bottom bar on desktop. */
  nowPlaying: 'player.now-playing',
  /** The up-next list. */
  queue: 'player.queue',
} as const

export const PLAYER_ROUTES = {
  nowPlaying: 'player.now-playing',
  queue: 'player.queue',
} as const

export const PLAYER_COMMANDS = {
  togglePlay: 'player.togglePlay',
  next: 'player.next',
  previous: 'player.previous',
} as const
