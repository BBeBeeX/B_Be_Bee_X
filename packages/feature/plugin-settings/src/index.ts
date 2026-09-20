/**
 * `plugin-settings` — application preferences and configuration service.
 *
 * Implements `ctx.settings` and contributes the `/settings` navigation route.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type { AppSettings, Disposable, SettingsService } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { SETTINGS_ROUTES } from './views.js'

const STORE_KEY = 'preferences'

function mergeSettings(base: AppSettings, patch?: Partial<AppSettings>): AppSettings {
  if (!patch) return { ...base }
  return {
    ...base,
    ...patch,
    desktopLyrics: {
      ...base.desktopLyrics,
      ...(patch.desktopLyrics ?? {}),
    },
    shortcuts: {
      ...base.shortcuts,
      ...(patch.shortcuts ?? {}),
      keybindings: {
        ...base.shortcuts.keybindings,
        ...(patch.shortcuts?.keybindings ?? {}),
      },
    },
    proxy: {
      ...base.proxy,
      ...(patch.proxy ?? {}),
      sourceRules: {
        ...base.proxy.sourceRules,
        ...(patch.proxy?.sourceRules ?? {}),
      },
    },
  }
}

export class SettingsPlugin extends Service implements SettingsService {
  static override readonly name = 'settings'
  static readonly inject = ['store']

  private readonly ownCtx: Context
  private current: AppSettings = mergeSettings(DEFAULT_APP_SETTINGS)

  constructor(ctx: Context) {
    super(ctx, 'settings')
    this.ownCtx = ctx
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-settings: initialized')
    try {
      const stored = await this.ownCtx.store.get<Partial<AppSettings>>(STORE_KEY)
      if (stored) {
        this.current = mergeSettings(DEFAULT_APP_SETTINGS, stored)
      }
    } catch (err) {
      this.ownCtx.logger.warn(`settings: failed to load persisted preferences: ${err}`)
    }

    this.ownCtx.inject(['ui'], (scoped) =>
      scoped.effect(function* () {
        scoped.logger.debug(`settings: contributing route ${SETTINGS_ROUTES.main}`)
        yield scoped.ui.contribute({
          kind: 'route',
          id: SETTINGS_ROUTES.main,
          path: '/settings',
          title: '设置',
          icon: 'settings',
          placement: ['sidebar', 'tab-bar'],
          order: 95,
        })
      }, 'settings-ui-contributions'),
    )
  }

  async get(): Promise<AppSettings> {
    return { ...this.current }
  }

  getSync(): AppSettings {
    return { ...this.current }
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    this.ownCtx.logger.debug('settings: update', partial)
    this.current = mergeSettings(this.current, partial)
    await this.ownCtx.store.set(STORE_KEY, this.current)
    this.ownCtx.emit('settings/changed', { ...this.current })
    return { ...this.current }
  }

  async reset(): Promise<AppSettings> {
    this.ownCtx.logger.info('settings: reset to defaults')
    this.current = { ...DEFAULT_APP_SETTINGS }
    await this.ownCtx.store.set(STORE_KEY, this.current)
    this.ownCtx.emit('settings/changed', { ...this.current })
    return { ...this.current }
  }

  onSettingsChange(listener: (settings: AppSettings) => void): Disposable {
    return this.ownCtx.on('settings/changed', listener)
  }
}

export const name = 'plugin-settings'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-settings: loaded')
  const fiber = await ctx.plugin(SettingsPlugin)
  return () => void fiber.dispose()
}

export default { name, apply }
