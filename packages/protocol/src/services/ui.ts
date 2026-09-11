/**
 * `ctx.ui` — the contribution registry.
 *
 * Plugins register renderer-agnostic *descriptors*; each shell resolves them
 * against its own component set. This is what lets one headless plugin serve
 * a React Native shell and a React DOM shell. See docs/08-ui-architecture.md.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable } from '../common.js'
import type { ParamSchema } from './audio.js'

/** Well-known extension points. Both shells implement the same set. */
export type SlotId =
  | 'now-playing.actions'
  | 'now-playing.panel'
  | 'track.context-menu'
  | 'album.context-menu'
  | 'library.sidebar'
  | 'search.results-section'
  | 'settings.sources'
  | 'source.browse'
  /** Desktop only; ignored on mobile. */
  | 'status-bar'

export interface SlotContext {
  [key: string]: unknown
}

export interface RouteContribution {
  kind: 'route'
  id: string
  path: string
  /** i18n key. */
  title: string
  icon?: string
  placement?: ('sidebar' | 'tab-bar' | 'more-menu')[]
  order?: number
}

export interface SlotContribution {
  kind: 'slot'
  id: string
  slot: SlotId
  order?: number
  /** Runs during render — must be synchronous and cheap. */
  when?: (ctx: SlotContext) => boolean
}

export interface CommandContribution {
  kind: 'command'
  id: string
  title: string
  icon?: string
  /** Desktop only; ignored on mobile. */
  defaultKeybinding?: string
  run(args?: unknown): void | Promise<void>
}

export interface SettingsContribution {
  kind: 'settings'
  id: string
  section: 'general' | 'playback' | 'audio' | 'sources' | 'storage' | 'advanced'
  title: string
  /** Rendered automatically unless a custom view is registered. */
  schema?: ParamSchema
}

export interface MenuContribution {
  kind: 'menu'
  id: string
  /** Desktop menu bar. Mobile maps these into the more-menu. */
  menu: 'file' | 'edit' | 'view' | 'playback' | 'help'
  title: string
  /** Menus never carry logic — they run a command. */
  command: string
  order?: number
  checked?: () => boolean
}

export type Contribution =
  | RouteContribution
  | SlotContribution
  | CommandContribution
  | SettingsContribution
  | MenuContribution

export interface UiService {
  contribute(c: Contribution): Disposable
  /**
   * Bind a view id to a component.
   *
   * Typed as `unknown` deliberately: `@BBeBee/protocol` must not depend on
   * `react`, `react-native`, or `react-dom`, since headless plugins import it
   * in contexts with no React at all. Shells cast once, at the boundary.
   */
  registerView(id: string, component: unknown): Disposable

  navigate(id: string, params?: Record<string, unknown>): void

  readonly routes: readonly RouteContribution[]
  slotsFor(slot: SlotId): readonly SlotContribution[]
  readonly commands: readonly CommandContribution[]
  readonly menus: readonly MenuContribution[]
  readonly settings: readonly SettingsContribution[]
  runCommand(id: string, args?: unknown): Promise<void>
  viewFor(id: string): unknown | undefined

  /**
   * Contributed ids with no view bound on this target.
   *
   * A direct consequence of ADR-2: a plugin may ship a desktop view and no
   * mobile one, and that is a normal state rather than an error. Shells use
   * this to say so out loud instead of rendering a silent blank.
   */
  missingViews(): string[]
}

declare module 'cordis' {
  interface Context {
    ui: UiService
  }
}
