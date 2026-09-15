/**
 * Collections: nested shelves, unique membership, cascade on delete.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'

const TRACK = 'BBeBee:demo:track:one'
const ALBUM = 'BBeBee:demo:album:first'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-library-collections') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(plugin)
  await tick()
  return { ctx, library: ctx.library }
}

describe('collections', () => {
  it('creates siblings in position order, nested by parent', async () => {
    const { library } = await harness()
    const first = await library.createCollection('First')
    const second = await library.createCollection('Second')
    const child = await library.createCollection('Child', { parentId: first.id })

    expect(first.position < second.position).toBe(true)
    expect(child.parentId).toBe(first.id)

    const all = await library.listCollections()
    expect(all.map((c) => c.id)).toEqual([first.id, second.id, child.id])
    expect(all.find((c) => c.id === child.id)?.itemCount).toBe(0)
  })

  it('refuses a parent that does not exist', async () => {
    const { library } = await harness()
    await expect(library.createCollection('Orphan', { parentId: 'nope' })).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('adds unique members, keeps order, and removes them', async () => {
    const { library } = await harness()
    const collection = await library.createCollection('Shelf')

    expect(await library.addToCollection(collection.id, [TRACK, ALBUM, TRACK])).toBe(2)
    const page = await library.listCollectionItems(collection.id)
    expect(page.items.map((item) => item.urn)).toEqual([TRACK, ALBUM])
    expect(page.items[0]!.position < page.items[1]!.position).toBe(true)

    await library.removeFromCollection(collection.id, [TRACK])
    const after = await library.listCollectionItems(collection.id)
    expect(after.items.map((item) => item.urn)).toEqual([ALBUM])
  })

  it('renames, and deletes a whole subtree', async () => {
    const { library } = await harness()
    const parent = await library.createCollection('Parent')
    const child = await library.createCollection('Child', { parentId: parent.id })
    await library.addToCollection(parent.id, [TRACK])

    await library.renameCollection(parent.id, 'Renamed')
    expect((await library.listCollections()).find((c) => c.id === parent.id)?.name).toBe('Renamed')

    await library.deleteCollection(parent.id)
    const rest = await library.listCollections()
    // The child went with the parent — the FK cascade is the one owner of the
    // tree's shape, so no service code walks it.
    expect(rest.map((c) => c.id)).not.toContain(parent.id)
    expect(rest.map((c) => c.id)).not.toContain(child.id)

    await expect(library.renameCollection(parent.id, 'Again')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('emits library/collections-changed for every mutation', async () => {
    const { ctx, library } = await harness()
    let events = 0
    ctx.on('library/collections-changed', () => void events++)

    const collection = await library.createCollection('Shelf')
    await library.addToCollection(collection.id, [TRACK])
    await library.renameCollection(collection.id, 'Shelf 2')
    await library.removeFromCollection(collection.id, [TRACK])
    await library.deleteCollection(collection.id)

    expect(events).toBe(5)
  })
})
