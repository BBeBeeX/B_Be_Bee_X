import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CollectionService } from "../src/services/collection"
import { FavoriteService } from "../src/services/favorite"
import { ImagesService } from "../src/services/image"
import { LyricService } from "../src/services/lyric"
import { PlaySourceCacheService } from "../src/services/playSourceCache"
import { PlayStatisticsService } from "../src/services/playStatistics"
import { TrackService } from "../src/services/track"
import {
  createCachePayload,
  createCacheStatus,
  createCollection,
  createCollectionItem,
  createFavorite,
  createImage,
  createLyric,
  createPlayDetail,
  createPlaySummary,
  createTrack,
} from "./support/factories"
import { createTestDatabase, destroyTestDatabase, type TestDatabaseContext } from "./support/testDb"

describe("database 音乐服务", () => {
  let context: TestDatabaseContext

  beforeEach(() => {
    context = createTestDatabase()
  })

  afterEach(() => {
    destroyTestDatabase(context)
  })

  describe("TrackService", () => {
    it("应批量保存曲目并支持默认读取", async () => {
      // Arrange - 准备数据
      const trackA = createTrack({ id: "track-a", sourceId: "source-a" })
      const trackB = createTrack({ id: "track-b", sourceId: "source-b" })

      // Act - 执行操作
      await TrackService.upsertMany([trackA, trackB])
      const byId = await TrackService.getById(trackA.id)
      const many = await TrackService.getManyByIds([trackA.id, trackB.id])
      const all = await TrackService.getAll()

      // Assert - 验证结果
      expect(byId?.id).toBe(trackA.id)
      expect(many).toHaveLength(2)
      expect(all).toHaveLength(2)
    })

    it("应在批量保存空数组时保持数据不变", async () => {
      // Arrange - 准备数据
      const track = createTrack({ id: "track-empty" })
      await TrackService.upsert(track)

      // Act - 执行操作
      await TrackService.upsertMany([])
      const all = await TrackService.getAll()

      // Assert - 验证结果
      expect(all.map((item) => item.id)).toEqual([track.id])
    })

    it("应通过单条保存更新已存在曲目", async () => {
      // Arrange - 准备数据
      const original = createTrack({
        id: "track-upsert",
        sourceId: "same-source",
        sourceSubId: "same-sub-source",
        title: "旧标题",
      })
      const updated = createTrack({
        id: "track-upsert-ignored",
        source: original.source,
        sourceId: original.sourceId,
        sourceSubId: original.sourceSubId,
        title: "新标题",
      })
      await TrackService.upsert(original)

      // Act - 执行操作
      await TrackService.upsert(updated)
      const all = await TrackService.getAll({ includeDeleted: true })

      // Assert - 验证结果
      expect(all).toHaveLength(1)
      expect(all[0]?.title).toBe("新标题")
    })

    it("应软删除曲目并在默认读取中排除它", async () => {
      // Arrange - 准备数据
      const track = createTrack({ id: "track-soft-delete" })
      await TrackService.upsert(track)

      // Act - 执行操作
      await TrackService.softDelete(track.id)
      const hidden = await TrackService.getById(track.id)
      const included = await TrackService.getById(track.id, { includeDeleted: true })
      const many = await TrackService.getManyByIds([track.id])

      // Assert - 验证结果
      expect(hidden).toBeUndefined()
      expect(included?.deletedAt).not.toBeNull()
      expect(many).toEqual([])
    })

    it("应在软删除不存在曲目时忽略操作", async () => {
      // Arrange - 准备数据
      const before = await TrackService.getAll({ includeDeleted: true })

      // Act - 执行操作
      await TrackService.softDelete("missing-track")
      const after = await TrackService.getAll({ includeDeleted: true })

      // Assert - 验证结果
      expect(after).toEqual(before)
    })

    it("应恢复已软删除曲目", async () => {
      // Arrange - 准备数据
      const track = createTrack({ id: "track-restore" })
      await TrackService.upsert(track)
      await TrackService.softDelete(track.id)

      // Act - 执行操作
      await TrackService.restore(track.id)
      const restored = await TrackService.getById(track.id)

      // Assert - 验证结果
      expect(restored?.deletedAt).toBeNull()
      expect(restored?.syncState).toBe("pending")
    })

    it("应在恢复不存在曲目时返回空结果", async () => {
      // Arrange - 准备数据
      const before = await TrackService.getAll({ includeDeleted: true })

      // Act - 执行操作
      await TrackService.restore("missing-track")
      const after = await TrackService.getAll({ includeDeleted: true })

      // Assert - 验证结果
      expect(after).toEqual(before)
    })

    it("应删除曲目并清空默认读取结果", async () => {
      // Arrange - 准备数据
      const track = createTrack({ id: "track-delete" })
      await TrackService.upsert(track)

      // Act - 执行操作
      await TrackService.delete(track.id)
      const byId = await TrackService.getById(track.id, { includeDeleted: true })
      const all = await TrackService.getAll({ includeDeleted: true })

      // Assert - 验证结果
      expect(byId).toBeUndefined()
      expect(all).toEqual([])
    })

    it("应在删除不存在曲目时保持空结果", async () => {
      // Arrange - 准备数据
      const before = await TrackService.getAll({ includeDeleted: true })

      // Act - 执行操作
      await TrackService.delete("missing-track")
      const after = await TrackService.getAll({ includeDeleted: true })

      // Assert - 验证结果
      expect(after).toEqual(before)
    })

    it("应在重置后清空曲目表并允许重复执行", async () => {
      // Arrange - 准备数据
      await TrackService.upsert(createTrack({ id: "track-reset" }))

      // Act - 执行操作
      await TrackService.reset()
      await TrackService.reset()
      const all = await TrackService.getAll({ includeDeleted: true })

      // Assert - 验证结果
      expect(all).toEqual([])
    })
  })

  describe("CollectionService", () => {
    it("应保存收藏并返回按创建时间排序的结果", async () => {
      // Arrange - 准备数据
      const older = createCollection({ id: "collection-older", createdAt: 1 })
      const newer = createCollection({ id: "collection-newer", createdAt: 2 })

      // Act - 执行操作
      await CollectionService.upsertCollection(newer)
      await CollectionService.upsertCollection(older)
      const all = await CollectionService.getAllCollections()

      // Assert - 验证结果
      expect(all.map((item) => item.id)).toEqual([older.id, newer.id])
    })

    it("应通过保存收藏更新已存在数据", async () => {
      // Arrange - 准备数据
      const collection = createCollection({ id: "collection-upsert", title: "旧名称" })
      await CollectionService.upsertCollection(collection)

      // Act - 执行操作
      await CollectionService.upsertCollection({ ...collection, title: "新名称" })
      const saved = await CollectionService.getCollection(collection.id)

      // Assert - 验证结果
      expect(saved?.title).toBe("新名称")
    })

    it("应保存收藏项并按顺序读取", async () => {
      // Arrange - 准备数据
      const collection = createCollection({ id: "collection-items" })
      const later = createCollectionItem(collection.id, { itemId: "item-2", sortOrder: 2 })
      const earlier = createCollectionItem(collection.id, { itemId: "item-1", sortOrder: 1 })

      // Act - 执行操作
      await CollectionService.saveCollectionWithItems(collection, [later, earlier])
      const items = await CollectionService.getCollectionItems(collection.id)
      const allItems = await CollectionService.getAllCollectionItems()

      // Assert - 验证结果
      expect(items.map((item) => item.itemId)).toEqual(["item-1", "item-2"])
      expect(allItems).toHaveLength(2)
    })

    it("应在保存空收藏项时清空旧成员", async () => {
      // Arrange - 准备数据
      const collection = createCollection({ id: "collection-clear" })
      await CollectionService.saveCollectionWithItems(collection, [
        createCollectionItem(collection.id, { itemId: "item-1" }),
      ])

      // Act - 执行操作
      await CollectionService.saveCollectionWithItems(collection, [])
      const items = await CollectionService.getCollectionItems(collection.id)

      // Assert - 验证结果
      expect(items).toEqual([])
    })

    it("应软删除收藏并允许显式读取已删除数据", async () => {
      // Arrange - 准备数据
      const collection = createCollection({ id: "collection-soft-delete" })
      await CollectionService.upsertCollection(collection)

      // Act - 执行操作
      await CollectionService.softDeleteCollection(collection.id)
      const hidden = await CollectionService.getCollection(collection.id)
      const included = await CollectionService.getCollection(collection.id, { includeDeleted: true })
      const all = await CollectionService.getAllCollections()
      const includedAll = await CollectionService.getAllCollections({ includeDeleted: true })

      // Assert - 验证结果
      expect(hidden).toBeUndefined()
      expect(included?.deletedAt).not.toBeNull()
      expect(all).toEqual([])
      expect(includedAll).toHaveLength(1)
    })

    it("应在软删除不存在收藏时忽略操作", async () => {
      // Arrange - 准备数据
      const before = await CollectionService.getAllCollections({ includeDeleted: true })

      // Act - 执行操作
      await CollectionService.softDeleteCollection("missing-collection")
      const after = await CollectionService.getAllCollections({ includeDeleted: true })

      // Assert - 验证结果
      expect(after).toEqual(before)
    })

    it("应在父收藏被软删除时默认隐藏收藏项", async () => {
      // Arrange - 准备数据
      const collection = createCollection({ id: "collection-parent-filter" })
      await CollectionService.saveCollectionWithItems(collection, [
        createCollectionItem(collection.id, { itemId: "child-a" }),
      ])
      await CollectionService.softDeleteCollection(collection.id)

      // Act - 执行操作
      const hidden = await CollectionService.getCollectionItems(collection.id)
      const included = await CollectionService.getCollectionItems(collection.id, {
        includeDeletedParents: true,
      })
      const visibleAll = await CollectionService.getAllCollectionItems()
      const includedAll = await CollectionService.getAllCollectionItems({ includeDeletedParents: true })

      // Assert - 验证结果
      expect(hidden).toEqual([])
      expect(included).toHaveLength(1)
      expect(visibleAll).toEqual([])
      expect(includedAll).toHaveLength(1)
    })

    it("应移除指定收藏项并在缺失项时保持其余数据不变", async () => {
      // Arrange - 准备数据
      const collection = createCollection({ id: "collection-remove-item" })
      await CollectionService.saveCollectionWithItems(collection, [
        createCollectionItem(collection.id, { itemId: "child-a", type: "track" }),
        createCollectionItem(collection.id, { itemId: "child-b", type: "track", sortOrder: 1 }),
      ])

      // Act - 执行操作
      await CollectionService.removeItem(collection.id, "child-a", "track")
      await CollectionService.removeItem(collection.id, "missing-child", "track")
      const items = await CollectionService.getCollectionItems(collection.id)

      // Assert - 验证结果
      expect(items.map((item) => item.itemId)).toEqual(["child-b"])
    })

    it("应删除收藏及其成员并在缺失收藏时保持空结果", async () => {
      // Arrange - 准备数据
      const collection = createCollection({ id: "collection-delete" })
      await CollectionService.saveCollectionWithItems(collection, [
        createCollectionItem(collection.id, { itemId: "child-a" }),
      ])

      // Act - 执行操作
      await CollectionService.deleteCollection(collection.id)
      await CollectionService.deleteCollection("missing-collection")
      const saved = await CollectionService.getCollection(collection.id, { includeDeleted: true })
      const items = await CollectionService.getCollectionItems(collection.id, {
        includeDeletedParents: true,
      })

      // Assert - 验证结果
      expect(saved).toBeUndefined()
      expect(items).toEqual([])
    })

    it("应在重置后清空收藏相关表并允许重复执行", async () => {
      // Arrange - 准备数据
      const collection = createCollection({ id: "collection-reset" })
      await CollectionService.saveCollectionWithItems(collection, [
        createCollectionItem(collection.id, { itemId: "child-a" }),
      ])

      // Act - 执行操作
      await CollectionService.reset()
      await CollectionService.reset()
      const allCollections = await CollectionService.getAllCollections({ includeDeleted: true })
      const allItems = await CollectionService.getAllCollectionItems({ includeDeletedParents: true })

      // Assert - 验证结果
      expect(allCollections).toEqual([])
      expect(allItems).toEqual([])
    })
  })

  describe("LyricService", () => {
    it("应保存歌词并支持按轨道与格式读取", async () => {
      // Arrange - 准备数据
      const lyric = createLyric({ id: "lyric-a", trackId: "track-lyric", format: "lrc" })

      // Act - 执行操作
      await LyricService.upsert(lyric)
      const byTrack = await LyricService.getByTrackId(lyric.trackId)
      const byFormat = await LyricService.getByTrackFormat(lyric.trackId, lyric.format)
      const byAudioAlias = await LyricService.getByAudioId(lyric.trackId)
      const all = await LyricService.getAll()

      // Assert - 验证结果
      expect(byTrack).toHaveLength(1)
      expect(byFormat?.id).toBe(lyric.id)
      expect(byAudioAlias).toHaveLength(1)
      expect(all).toHaveLength(1)
    })

    it("应通过保存歌词更新相同轨道与格式的数据", async () => {
      // Arrange - 准备数据
      const lyric = createLyric({ id: "lyric-update-a", trackId: "track-lyric-update", format: "lrc" })
      await LyricService.upsert(lyric)

      // Act - 执行操作
      await LyricService.upsert({
        ...lyric,
        id: "lyric-update-b",
        updatedAt: lyric.updatedAt + 1,
        translations: [{ language: "zh-CN", content: "更新" }],
      })
      const all = await LyricService.getByTrackId(lyric.trackId, { includeDeleted: true })

      // Assert - 验证结果
      expect(all).toHaveLength(1)
      expect(all[0]?.translations?.[0]?.language).toBe("zh-CN")
    })

    it("应软删除歌词并在默认读取中隐藏它", async () => {
      // Arrange - 准备数据
      const lyric = createLyric({ id: "lyric-soft-delete", trackId: "track-lyric-soft" })
      await LyricService.upsert(lyric)

      // Act - 执行操作
      await LyricService.softDelete(lyric.id)
      const hidden = await LyricService.getByTrackId(lyric.trackId)
      const included = await LyricService.getByTrackId(lyric.trackId, { includeDeleted: true })

      // Assert - 验证结果
      expect(hidden).toEqual([])
      expect(included[0]?.deletedAt).not.toBeNull()
    })

    it("应在软删除不存在歌词时保持空结果", async () => {
      // Arrange - 准备数据
      const before = await LyricService.getAll({ includeDeleted: true })

      // Act - 执行操作
      await LyricService.softDelete("missing-lyric")
      const after = await LyricService.getAll({ includeDeleted: true })

      // Assert - 验证结果
      expect(after).toEqual(before)
    })

    it("应删除歌词并在缺失记录时保持空结果", async () => {
      // Arrange - 准备数据
      const lyric = createLyric({ id: "lyric-delete", trackId: "track-lyric-delete" })
      await LyricService.upsert(lyric)

      // Act - 执行操作
      await LyricService.delete(lyric.id)
      await LyricService.delete("missing-lyric")
      const all = await LyricService.getAll({ includeDeleted: true })
      const missingFormat = await LyricService.getByTrackFormat("missing", "lrc")

      // Assert - 验证结果
      expect(all).toEqual([])
      expect(missingFormat).toBeUndefined()
    })

    it("应在重置后清空歌词表并允许重复执行", async () => {
      // Arrange - 准备数据
      await LyricService.upsert(createLyric({ id: "lyric-reset" }))

      // Act - 执行操作
      await LyricService.reset()
      await LyricService.reset()
      const all = await LyricService.getAll({ includeDeleted: true })

      // Assert - 验证结果
      expect(all).toEqual([])
    })
  })

  describe("FavoriteService 与 ImagesService", () => {
    it("应保存收藏标记并支持查询存在性", async () => {
      // Arrange - 准备数据
      const favorite = createFavorite({ audioId: "favorite-a", createdAt: 10 })

      // Act - 执行操作
      await FavoriteService.add(favorite)
      const all = await FavoriteService.getAll()
      const many = await FavoriteService.getMany([favorite.audioId])
      const has = await FavoriteService.has(favorite.audioId)

      // Assert - 验证结果
      expect(all).toHaveLength(1)
      expect(many).toHaveLength(1)
      expect(has).toBe(true)
    })

    it("应在重复保存收藏标记时覆盖旧值并处理空查询", async () => {
      // Arrange - 准备数据
      const favorite = createFavorite({ audioId: "favorite-update", createdAt: 10 })
      await FavoriteService.add(favorite)

      // Act - 执行操作
      await FavoriteService.add({ ...favorite, createdAt: 20 })
      const all = await FavoriteService.getAll()
      const many = await FavoriteService.getMany([])
      const has = await FavoriteService.has("missing-favorite")

      // Assert - 验证结果
      expect(all[0]?.createdAt).toBe(20)
      expect(many).toEqual([])
      expect(has).toBe(false)
    })

    it("应删除收藏标记并在重置后保持空结果", async () => {
      // Arrange - 准备数据
      const favorite = createFavorite({ audioId: "favorite-delete" })
      await FavoriteService.add(favorite)

      // Act - 执行操作
      await FavoriteService.remove(favorite.audioId)
      await FavoriteService.remove("missing-favorite")
      await FavoriteService.reset()
      await FavoriteService.reset()
      const all = await FavoriteService.getAll()

      // Assert - 验证结果
      expect(all).toEqual([])
    })

    it("应批量保存图片颜色并支持读取全部结果", async () => {
      // Arrange - 准备数据
      const imageA = createImage({ url: "https://example.com/a.jpg" })
      const imageB = createImage({ url: "https://example.com/b.jpg" })

      // Act - 执行操作
      await ImagesService.upsertMany([imageA, imageB])
      const all = await ImagesService.getImageAll()

      // Assert - 验证结果
      expect(all).toHaveLength(2)
    })

    it("应在批量保存空图片集合时保持现有数据不变", async () => {
      // Arrange - 准备数据
      const image = createImage({ url: "https://example.com/single.jpg" })
      await ImagesService.upsertMany([image])

      // Act - 执行操作
      await ImagesService.upsertMany([])
      const all = await ImagesService.getImageAll()

      // Assert - 验证结果
      expect(all).toHaveLength(1)
    })

    it("应在重置图片表后保持空结果", async () => {
      // Arrange - 准备数据
      await ImagesService.upsertMany([createImage({ url: "https://example.com/reset.jpg" })])

      // Act - 执行操作
      await ImagesService.reset()
      await ImagesService.reset()
      const all = await ImagesService.getImageAll()

      // Assert - 验证结果
      expect(all).toEqual([])
    })
  })

  describe("PlayStatisticsService 与 PlaySourceCacheService", () => {
    it("应记录播放明细并维护汇总结果", async () => {
      // Arrange - 准备数据
      const first = createPlayDetail({ id: "detail-1", trackId: "track-stat", playedDurationMs: 10_000, playedAt: 100 })
      const second = createPlayDetail({ id: "detail-2", trackId: "track-stat", playedDurationMs: 20_000, playedAt: 200 })

      // Act - 执行操作
      await PlayStatisticsService.recordPlay(first)
      await PlayStatisticsService.recordPlay(second)
      const details = await PlayStatisticsService.getDetails(first.trackId)
      const summary = await PlayStatisticsService.getSummary(first.trackId)
      const allDetails = await PlayStatisticsService.getAllDetails()
      const allSummaries = await PlayStatisticsService.getAllSummaries()

      // Assert - 验证结果
      expect(details.map((item) => item.id)).toEqual(["detail-2", "detail-1"])
      expect(summary?.playCount).toBe(2)
      expect(summary?.totalPlayedDurationMs).toBe(30_000)
      expect(allDetails).toHaveLength(2)
      expect(allSummaries).toHaveLength(1)
    })

    it("应通过汇总写入覆盖现有汇总并在缺失记录时返回空结果", async () => {
      // Arrange - 准备数据
      const summary = createPlaySummary({ trackId: "track-summary", playCount: 1 })
      await PlayStatisticsService.upsertSummary(summary)

      // Act - 执行操作
      await PlayStatisticsService.upsertSummary({ ...summary, playCount: 5 })
      const saved = await PlayStatisticsService.getSummary(summary.trackId)
      const missing = await PlayStatisticsService.getSummary("missing-track")

      // Assert - 验证结果
      expect(saved?.playCount).toBe(5)
      expect(missing).toBeUndefined()
    })

    it("应在重置播放统计后清空所有结果并允许重复执行", async () => {
      // Arrange - 准备数据
      await PlayStatisticsService.recordPlay(createPlayDetail({ trackId: "track-reset-stat" }))

      // Act - 执行操作
      await PlayStatisticsService.reset()
      await PlayStatisticsService.reset()
      const details = await PlayStatisticsService.getAllDetails()
      const summaries = await PlayStatisticsService.getAllSummaries()

      // Assert - 验证结果
      expect(details).toEqual([])
      expect(summaries).toEqual([])
    })

    it("应读取有效播放源缓存状态", async () => {
      // Arrange - 准备数据
      const payload = createCachePayload({ cacheKey: "cache-valid" })
      const status = createCacheStatus(payload.cacheKey, { status: "valid", expiresAt: Date.now() + 10_000 })

      // Act - 执行操作
      await PlaySourceCacheService.upsertPayload(payload)
      await PlaySourceCacheService.upsertStatus(status)
      const joined = await PlaySourceCacheService.getPayloadWithStatus(payload.cacheKey)
      const valid = await PlaySourceCacheService.getValidPayloadWithStatus(payload.cacheKey)

      // Assert - 验证结果
      expect(joined).toHaveLength(1)
      expect(valid).toHaveLength(1)
    })

    it("应在状态无效或过期时排除默认有效缓存结果", async () => {
      // Arrange - 准备数据
      const payload = createCachePayload({ cacheKey: "cache-invalid" })

      // Act - 执行操作
      await PlaySourceCacheService.upsertPayload(payload)
      await PlaySourceCacheService.upsertStatus(
        createCacheStatus(payload.cacheKey, { status: "error", expiresAt: Date.now() - 10_000 }),
      )
      const valid = await PlaySourceCacheService.getValidPayloadWithStatus(payload.cacheKey)
      const missing = await PlaySourceCacheService.getPayloadWithStatus("missing-cache")

      // Assert - 验证结果
      expect(valid).toEqual([])
      expect(missing).toEqual([])
    })

    it("应在重置缓存表后保持空结果", async () => {
      // Arrange - 准备数据
      const payload = createCachePayload({ cacheKey: "cache-reset" })
      await PlaySourceCacheService.upsertPayload(payload)
      await PlaySourceCacheService.upsertStatus(createCacheStatus(payload.cacheKey))

      // Act - 执行操作
      await PlaySourceCacheService.reset()
      await PlaySourceCacheService.reset()
      const joined = await PlaySourceCacheService.getPayloadWithStatus(payload.cacheKey)

      // Assert - 验证结果
      expect(joined).toEqual([])
    })
  })
})
