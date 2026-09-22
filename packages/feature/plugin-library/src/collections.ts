/**
 * Collections: nested folders of arbitrary URNs.
 *
 * A collection is a shelf, not a playlist: its members may be tracks, albums,
 * artists or playlists, membership is unique per collection, and order is a
 * fractional index among siblings so a drop writes one row (docs/07 §4.6).
 *
 * Deleting one takes its children with it through the schema's
 * `ON DELETE CASCADE`; the service does not walk the tree itself, because two
 * places that know a tree's shape eventually disagree about it.
 */

import { between, LibraryError, parseUrn } from '@BBeBee/protocol'
import type { Collection, CollectionItem, DbService, PageRequest, Paged } from '@BBeBee/protocol'
import { limitOf, offsetOf, paged } from './paging.js'
import { newId } from './ids.js'
import { requiredName } from './playlists.js'

interface CollectionRow {
  id: string
  parent_id: string | null
  name: string
  position: string
  created_at: number
  item_count: number
}

export class Collections {
  constructor(private readonly db: DbService) {}

  async list(): Promise<readonly Collection[]> {
    const rows = await this.db.query<CollectionRow>(
      `SELECT c.id, c.parent_id, c.name, c.position, c.created_at,
              (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
         FROM collections c
        ORDER BY COALESCE(c.parent_id, '') ASC, c.position ASC, c.id ASC`,
    )
    return rows.map(toCollection)
  }

  async create(name: string, opts: { parentId?: string } = {}): Promise<Collection> {
    const clean = requiredName(name)
    if (opts.parentId !== undefined) await this.require(opts.parentId)

    const last = await this.db.get<{ position: string }>(
      'SELECT position FROM collections WHERE parent_id IS ? ORDER BY position DESC LIMIT 1',
      [opts.parentId ?? null],
    )
    const now = Date.now()
    const collection: Collection = {
      id: newId('col'),
      name: clean,
      position: between(last?.position, undefined),
      createdAt: now,
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
      itemCount: 0,
    }
    await this.db.exec(
      'INSERT INTO collections (id, parent_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)',
      [collection.id, opts.parentId ?? null, clean, collection.position, now],
    )
    return collection
  }

  async rename(id: string, name: string): Promise<void> {
    const result = await this.db.exec('UPDATE collections SET name = ? WHERE id = ?', [
      requiredName(name),
      id,
    ])
    if (result.changes === 0) throw notFound(id)
  }

  async move(id: string, parentId: string | null): Promise<void> {
    await this.require(id)
    if (parentId !== null) {
      if (parentId === id) throw new LibraryError('cannot move collection into itself', 'invalid-name')
      await this.require(parentId)
    }
    await this.db.exec('UPDATE collections SET parent_id = ? WHERE id = ?', [parentId, id])
  }

  async remove(id: string): Promise<void> {
    const result = await this.db.exec('DELETE FROM collections WHERE id = ?', [id])
    if (result.changes === 0) throw notFound(id)
  }

  async items(id: string, page?: PageRequest): Promise<Paged<CollectionItem>> {
    await this.require(id)
    const limit = limitOf(page)
    const offset = offsetOf(page?.cursor)
    const rows = await this.db.query<{ urn: string; position: string }>(
      `SELECT urn, position FROM collection_items
        WHERE collection_id = ?
        ORDER BY position ASC
        LIMIT ? OFFSET ?`,
      [id, limit + 1, offset],
    )
    return paged(rows, offset, limit)
  }

  async add(id: string, urns: readonly string[]): Promise<number> {
    await this.require(id)
    if (urns.length === 0) return 0
    for (const urn of urns) assertUrn(urn)

    let added = 0
    await this.db.transaction(async (tx) => {
      const last = await tx.get<{ position: string }>(
        'SELECT position FROM collection_items WHERE collection_id = ? ORDER BY position DESC LIMIT 1',
        [id],
      )
      let previous = last?.position
      for (const urn of urns) {
        const position = between(previous, undefined)
        const result = await tx.exec(
          `INSERT INTO collection_items (collection_id, urn, position)
           VALUES (?, ?, ?)
           ON CONFLICT(collection_id, urn) DO NOTHING`,
          [id, urn, position],
        )
        if (result.changes > 0) {
          added++
          // Only advance on a row that landed: an ignored duplicate must not
          // leave a gap for the next position to leap over.
          previous = position
        }
      }
    })
    return added
  }

  async removeItems(id: string, urns: readonly string[]): Promise<void> {
    await this.require(id)
    if (urns.length === 0) return
    const holes = urns.map(() => '?').join(', ')
    await this.db.exec(
      `DELETE FROM collection_items WHERE collection_id = ? AND urn IN (${holes})`,
      [id, ...urns],
    )
  }

  private async require(id: string): Promise<CollectionRow> {
    const row = await this.db.get<CollectionRow>(
      `SELECT c.id, c.parent_id, c.name, c.position, c.created_at,
              (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
         FROM collections c
        WHERE c.id = ?`,
      [id],
    )
    if (!row) throw notFound(id)
    return row
  }
}

function toCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    createdAt: row.created_at,
    itemCount: row.item_count,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
  }
}

function assertUrn(urn: string): void {
  try {
    parseUrn(urn)
  } catch (error) {
    throw new LibraryError(`invalid urn ${JSON.stringify(urn)}`, 'invalid-urn', { cause: error })
  }
}

function notFound(id: string): LibraryError {
  return new LibraryError(`no collection ${id}`, 'not-found')
}
