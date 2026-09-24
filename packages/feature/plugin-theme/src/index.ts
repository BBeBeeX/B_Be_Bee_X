/**
 * `plugin-theme` — application color management and theme service.
 *
 * Implements `ctx.theme` and provides dynamic theme registration,
 * real-time CSS variable injection into the DOM, and persistence.
 */

import { Service } from '@BBeBee/kernel'
import type { Context } from '@BBeBee/kernel'
import type { Disposable, ThemeDefinition, ThemeService } from '@BBeBee/protocol'
import {
  applyThemeToDom,
  builtInThemes,
  defaultTheme,
} from '@BBeBee/ui-tokens'

const STORE_KEY = 'theme_preference'

export class ThemePlugin extends Service implements ThemeService {
  static override readonly name = 'theme'
  static readonly inject = []

  private readonly ownCtx: Context
  private readonly registry = new Map<string, ThemeDefinition>()
  private activeThemeId = defaultTheme.id

  constructor(ctx: Context) {
    super(ctx, 'theme')
    this.ownCtx = ctx

    // Seed registry with built-in themes
    for (const [id, def] of Object.entries(builtInThemes)) {
      this.registry.set(id, def)
    }
  }

  async [Service.init]() {
    this.ownCtx.logger?.info?.('plugin-theme: initialized')

    // 1. Try to restore persisted theme preference via store if available
    this.ownCtx.inject(['store'], (scoped) => {
      void scoped.store.get<string>(STORE_KEY).then((storedId) => {
        if (storedId && this.registry.has(storedId)) {
          this.activeThemeId = storedId
          this.applyActiveTheme()
        }
      }).catch(() => {})
    })

    // 2. Synchronize with settings if available
    this.ownCtx.inject(['settings'], (scoped) => {
      const initial = scoped.settings.getSync?.()
      if (initial?.themeId && this.registry.has(initial.themeId)) {
        this.activeThemeId = initial.themeId
        this.applyActiveTheme()
      }

      scoped.on('settings/changed', (s) => {
        if (s.themeId && s.themeId !== this.activeThemeId && this.registry.has(s.themeId)) {
          void this.setTheme(s.themeId)
        }
      })
    })

    // 3. Immediately apply the active theme to DOM
    this.applyActiveTheme()
  }

  getThemes(): readonly ThemeDefinition[] {
    return Array.from(this.registry.values())
  }

  getCurrentTheme(): ThemeDefinition {
    return this.registry.get(this.activeThemeId) ?? defaultTheme
  }

  async setTheme(themeId: string): Promise<void> {
    const target = this.registry.get(themeId)
    if (!target) {
      this.ownCtx.logger.warn(`theme: unknown theme id "${themeId}"`)
      return
    }

    if (this.activeThemeId === themeId) return

    this.activeThemeId = themeId
    this.applyActiveTheme()

    // Persist to store
    try {
      const store = (this.ownCtx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
        .reflect?.get('store', false) as { set(k: string, v: unknown): Promise<void> } | undefined
      if (store) {
        await store.set(STORE_KEY, themeId)
      }
    } catch (err) {
      this.ownCtx.logger?.warn?.(`theme: failed to persist theme: ${err}`)
    }

    // Sync with settings service if present
    const settings = (this.ownCtx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
      .reflect?.get('settings', false) as { update(p: unknown): Promise<unknown> } | undefined
    if (settings) {
      void settings.update({ themeId }).catch(() => {})
    }

    this.ownCtx.emit('theme/changed', target)
  }

  registerTheme(theme: ThemeDefinition): Disposable {
    this.registry.set(theme.id, theme)
    this.ownCtx.logger.info(`theme: registered runtime theme "${theme.id}" (${theme.name})`)
    this.ownCtx.emit('theme/registry-changed', this.getThemes())

    return () => {
      if (this.registry.delete(theme.id)) {
        this.ownCtx.logger.info(`theme: unregistered runtime theme "${theme.id}"`)
        if (this.activeThemeId === theme.id) {
          void this.setTheme(defaultTheme.id)
        }
        this.ownCtx.emit('theme/registry-changed', this.getThemes())
      }
    }
  }

  onThemeChange(listener: (theme: ThemeDefinition) => void): Disposable {
    return this.ownCtx.on('theme/changed', listener)
  }

  private applyActiveTheme(): void {
    const current = this.getCurrentTheme()
    applyThemeToDom(current)
  }
}

export const name = 'plugin-theme'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-theme: loaded')
  const fiber = await ctx.plugin(ThemePlugin)
  return () => void fiber.dispose()
}

export default { name, apply }
