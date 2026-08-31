/**
 * The M0 demonstration plugin.
 *
 * Its job is to be *boring* and to prove one thing: the same package activates
 * on Electron and on React Native with **no conditional code**. So it uses the
 * platform only through core services — `db`, `store`, `fs`, `logger` — and
 * contributes UI only as descriptors, never as components.
 *
 * Everything visible lives in `@BBeBee/plugin-hello-ui-desktop` and
 * `-ui-mobile`; this package has no idea either exists.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { nsPrefix } from '@BBeBee/kernel'
// Pulls the service augmentations (`ctx.db`, `ctx.ui`, …) into this program.
// Without it a consumer compiling this package in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'

export interface HelloConfig {
  /** Shown by whichever shell renders the view. */
  greeting?: string
}

/** The view id both shells bind a component to. */
export const HELLO_VIEW = 'hello.panel'

export interface HelloState {
  greeting: string
  /** How many times the app has started with this plugin enabled. */
  launchCount: number
  /** Rows in the demo table — proves `db` works and migrations ran. */
  noteCount: number
  platformNote: string
}

export class Hello extends Service {
  private state: HelloState = {
    greeting: 'Hello',
    launchCount: 0,
    noteCount: 0,
    platformNote: '',
  }

  private readonly instanceId: string
  /** Own table name, derived from the namespace the gate expects. */
  private readonly table: string

  constructor(
    ctx: Context,
    private readonly config: HelloConfig & { instanceId?: string } = {},
  ) {
    super(ctx, 'hello')
    this.instanceId = config.instanceId ?? '@BBeBee/plugin-hello'
    this.table = `${nsPrefix(`plugin:${this.instanceId}`)}_notes`
  }

  static inject = ['db', 'store', 'ui', 'device']

  async [Service.init]() {
    // A plugin-owned table, created through the namespaced migration API —
    // the platform's promise that a plugin can own schema (docs/07 §6).
    await this.ctx.db.defineSchema(`plugin:${this.instanceId}`, [
      {
        version: 1,
        up: `CREATE TABLE {{ns}}_notes (
               id   INTEGER PRIMARY KEY AUTOINCREMENT,
               text TEXT NOT NULL,
               at   INTEGER NOT NULL
             )`,
      },
    ])

    const previous = (await this.ctx.store.get<number>('launchCount')) ?? 0
    const launchCount = previous + 1
    await this.ctx.store.set('launchCount', launchCount)

    await this.addNote(`launch #${launchCount}`)

    this.state = {
      greeting: this.config.greeting ?? 'Hello',
      launchCount,
      noteCount: await this.countNotes(),
      // The one place the platform is named — as *data* the shell displays,
      // never as a branch that changes behaviour.
      platformNote: `${this.ctx.device.platform} · ${this.ctx.device.formFactor}`,
    }

    this.ctx.logger.info(`hello: launch ${launchCount}, ${this.state.noteCount} notes`)

    return this.ctx.effect(function* (this: Hello) {
      yield this.ctx.ui.contribute({
        kind: 'route',
        id: HELLO_VIEW,
        path: '/hello',
        title: 'Hello',
        icon: 'sparkles',
        placement: ['sidebar', 'tab-bar'],
        order: 10,
      })
      yield this.ctx.ui.contribute({
        kind: 'command',
        id: 'hello.addNote',
        title: 'Hello: add a note',
        defaultKeybinding: 'CmdOrCtrl+Shift+H',
        run: () => this.addNote('added from a command'),
      })
    }.bind(this), 'hello-contributions')
  }

  get snapshot(): Readonly<HelloState> {
    return this.state
  }

  async addNote(text: string): Promise<void> {
    await this.ctx.db.exec(`INSERT INTO ${this.table} (text, at) VALUES (?, ?)`, [
      text,
      Date.now(),
    ])
    this.state = { ...this.state, noteCount: await this.countNotes() }
    this.ctx.emit('hello/changed', this.state)
  }

  private async countNotes(): Promise<number> {
    const row = await this.ctx.db.get<{ n: number }>(
      `SELECT count(*) AS n FROM ${this.table}`,
    )
    return Number(row?.n ?? 0)
  }
}

declare module 'cordis' {
  interface Context {
    hello: Hello
  }
  interface Events {
    'hello/changed'(state: Readonly<HelloState>): void
  }
}

export const name = 'plugin-hello'

/**
 * Awaited deliberately.
 *
 * A wrapper that fires `ctx.plugin()` without awaiting resolves immediately,
 * so `await ctx.plugin(thisPlugin)` tells a caller nothing about whether the
 * service inside is ready — its async `Service.init` may still be running.
 * Awaiting propagates readiness to whoever loaded us.
 */
export async function apply(ctx: Context, config: HelloConfig = {}) {
  const fiber = await ctx.plugin(Hello, config)
  return () => void fiber.dispose()
}

export default { name, apply }
