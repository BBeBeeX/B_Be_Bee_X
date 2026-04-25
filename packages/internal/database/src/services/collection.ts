import { and, asc, eq, inArray, isNull } from "drizzle-orm"

import { db } from "../db"
import { collectionItemsTable, collectionsTable } from "../schemas"
import type { CollectionItemSchema, CollectionSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { applyLocalSyncDefaults, conflictUpdateAllExcept } from "./internal/utils"

class CollectionServiceStatic implements Resetable {
  async reset() {
    await db.delete(collectionItemsTable).execute()
    await db.delete(collectionsTable).execute()
  }

  async upsertCollection(input: CollectionSchema) {
    const collection = applyLocalSyncDefaults(input)
    await db
      .insert(collectionsTable)
      .values(collection)
      .onConflictDoUpdate({
        target: [collectionsTable.id],
        set: conflictUpdateAllExcept(collectionsTable, ["id"]),
      })
  }

  async saveCollectionWithItems(collection: CollectionSchema, items: CollectionItemSchema[]) {
    await this.upsertCollection(collection)
    await db
      .delete(collectionItemsTable)
      .where(eq(collectionItemsTable.collectionId, collection.id))

    if (items.length === 0) return

    await db
      .insert(collectionItemsTable)
      .values(items)
      .onConflictDoUpdate({
        target: [collectionItemsTable.collectionId, collectionItemsTable.itemId, collectionItemsTable.type],
        set: conflictUpdateAllExcept(collectionItemsTable, ["collectionId", "itemId", "type"]),
      })
  }

  async softDeleteCollection(collectionId: string) {
    await db
      .update(collectionsTable)
      .set({
        deletedAt: Date.now(),
        dirty: true,
        syncState: "pending",
        updatedAt: Date.now(),
      })
      .where(eq(collectionsTable.id, collectionId))
  }

  async deleteCollection(collectionId: string) {
    await db.delete(collectionItemsTable).where(eq(collectionItemsTable.collectionId, collectionId))
    await db.delete(collectionsTable).where(eq(collectionsTable.id, collectionId))
  }

  async removeItem(collectionId: string, itemId: string, type?: CollectionItemSchema["type"]) {
    const conditions = [
      eq(collectionItemsTable.collectionId, collectionId),
      eq(collectionItemsTable.itemId, itemId),
    ]
    if (type) {
      conditions.push(eq(collectionItemsTable.type, type))
    }

    await db.delete(collectionItemsTable).where(and(...conditions))
  }

  getCollection(collectionId: string, options?: { includeDeleted?: boolean }) {
    return db.query.collectionsTable.findFirst({
      where: options?.includeDeleted
        ? eq(collectionsTable.id, collectionId)
        : and(eq(collectionsTable.id, collectionId), isNull(collectionsTable.deletedAt)),
    })
  }

  async getCollectionItems(collectionId: string, options?: { includeDeletedParents?: boolean }) {
    if (!options?.includeDeletedParents) {
      const collection = await this.getCollection(collectionId)
      if (!collection) return []
    }

    return db.query.collectionItemsTable.findMany({
      where: eq(collectionItemsTable.collectionId, collectionId),
      orderBy: [asc(collectionItemsTable.sortOrder), asc(collectionItemsTable.addedAt)],
    })
  }

  async getAllCollectionItems(options?: { includeDeletedParents?: boolean }) {
    if (options?.includeDeletedParents) {
      return db.query.collectionItemsTable.findMany({
        orderBy: [
          asc(collectionItemsTable.collectionId),
          asc(collectionItemsTable.sortOrder),
          asc(collectionItemsTable.addedAt),
        ],
      })
    }

    const activeCollections = await db.query.collectionsTable.findMany({
      where: isNull(collectionsTable.deletedAt),
    })
    const collectionIds = activeCollections.map((collection) => collection.id)
    if (collectionIds.length === 0) return []

    return db.query.collectionItemsTable.findMany({
      where: inArray(collectionItemsTable.collectionId, collectionIds),
      orderBy: [
        asc(collectionItemsTable.collectionId),
        asc(collectionItemsTable.sortOrder),
        asc(collectionItemsTable.addedAt),
      ],
    })
  }

  getAllCollections(options?: { includeDeleted?: boolean }) {
    return db.query.collectionsTable.findMany({
      where: options?.includeDeleted ? undefined : isNull(collectionsTable.deletedAt),
      orderBy: [asc(collectionsTable.createdAt)],
    })
  }
}

export const CollectionService = new CollectionServiceStatic()
