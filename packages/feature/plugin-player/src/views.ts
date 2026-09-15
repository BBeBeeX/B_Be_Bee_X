/**
 * The view ids `plugin-player` contributes.
 *
 * Shared by both view packages so a descriptor and the component that fills
 * it cannot drift apart: the headless plugin contributes the descriptor, each
 * kit binds a component to the same id, and the shell resolves whichever one
 * was loaded (docs/08 3).
 *
 * The "what is playing" surfaces — the full-screen player and the bar — moved
 * to `plugin-now-playing`; what remains here is the up-next list, which is a
 * view of the queue this plugin owns.
 */

export const PLAYER_VIEWS = {
  /** The up-next list. */
  queue: 'player.queue',
} as const

export const PLAYER_ROUTES = {
  queue: 'player.queue',
} as const

export const PLAYER_COMMANDS = {
  togglePlay: 'player.togglePlay',
  next: 'player.next',
  previous: 'player.previous',
} as const
