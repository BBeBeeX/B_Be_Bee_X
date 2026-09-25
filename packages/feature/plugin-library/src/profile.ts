/**
 * The local user: one row in `library_profile`.
 *
 * Created on first run with a UUID id and the default name "Mine"; the name
 * is editable in Settings and is what created playlists display as their
 * creator. The table itself comes from core migration v6 — like the other
 * curation tables, its schema is the kernel's business, its rows are ours.
 */

import type { UserProfile } from '@BBeBee/protocol'
import type { DbService } from '@BBeBee/protocol'
import { randomUuid } from './ids.js'

export const DEFAULT_USER_NAME = 'Mine'

export class Profile {
  constructor(private readonly db: DbService) {}

  /** Create the row on first run; afterwards this is a read. */
  async ensure(): Promise<UserProfile> {
    const rows = await this.db.query<{ id: string; name: string }>(
      'SELECT id, name FROM library_profile LIMIT 1',
      [],
    )
    if (rows[0]) return rows[0]

    const id = randomUuid()
    await this.db.exec('INSERT INTO library_profile (id, name) VALUES (?, ?)', [
      id,
      DEFAULT_USER_NAME,
    ])
    return { id, name: DEFAULT_USER_NAME }
  }

  /** Apply a patch (currently the name) and answer the row as it now stands. */
  async update(patch: { name?: string }): Promise<UserProfile> {
    const current = await this.ensure()
    const name = patch.name?.trim()
    if (name) {
      await this.db.exec('UPDATE library_profile SET name = ? WHERE id = ?', [name, current.id])
    }
    const rows = await this.db.query<{ id: string; name: string }>(
      'SELECT id, name FROM library_profile WHERE id = ?',
      [current.id],
    )
    return rows[0] ?? current
  }
}
