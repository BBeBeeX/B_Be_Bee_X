import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ImportJobService } from "../src/services/importJob"
import { LocalFileService } from "../src/services/localFile"
import { PlaybackQueueService } from "../src/services/playbackQueue"
import { ProxySettingsService } from "../src/services/proxySettings"
import { SettingService } from "../src/services/setting"
import {
  createImportJob,
  createLocalFile,
  createLocalFileLink,
  createPlaybackQueue,
  createPlaybackQueueItem,
  createProxySettings,
  createSetting,
} from "./support/factories"
import { createTestDatabase, destroyTestDatabase, type TestDatabaseContext } from "./support/testDb"

describe("database 辅助持久化服务", () => {
  let context: TestDatabaseContext

  beforeEach(() => {
    context = createTestDatabase()
  })

  afterEach(() => {
    destroyTestDatabase(context)
  })

  describe("ImportJobService", () => {
    it("应保存导入任务并按更新时间倒序读取", async () => {
      // Arrange - 准备数据
      const older = createImportJob({ id: "job-older", updatedAt: 1 })
      const newer = createImportJob({ id: "job-newer", updatedAt: 2 })

      // Act - 执行操作
      await ImportJobService.upsert(older)
      await ImportJobService.upsert(newer)
      const byId = await ImportJobService.getById(newer.id)
      const all = await ImportJobService.getAll()

      // Assert - 验证结果
      expect(byId?.id).toBe(newer.id)
      expect(all.map((item) => item.id)).toEqual([newer.id, older.id])
    })

    it("应覆盖已存在导入任务并在缺失记录时返回空结果", async () => {
      // Arrange - 准备数据
      const job = createImportJob({ id: "job-update", status: "pending" })
      await ImportJobService.upsert(job)

      // Act - 执行操作
      await ImportJobService.upsert({ ...job, status: "completed" })
      const saved = await ImportJobService.getById(job.id)
      const missing = await ImportJobService.getById("missing-job")

      // Assert - 验证结果
      expect(saved?.status).toBe("completed")
      expect(missing).toBeUndefined()
    })

    it("应删除导入任务并在重置后保持空结果", async () => {
      // Arrange - 准备数据
      const job = createImportJob({ id: "job-delete" })
      await ImportJobService.upsert(job)

      // Act - 执行操作
      await ImportJobService.delete(job.id)
      await ImportJobService.delete("missing-job")
      await ImportJobService.reset()
      await ImportJobService.reset()
      const all = await ImportJobService.getAll()

      // Assert - 验证结果
      expect(all).toEqual([])
    })
  })

  describe("LocalFileService", () => {
    it("应保存本地文件并按路径排序读取", async () => {
      // Arrange - 准备数据
      const fileB = createLocalFile({ id: "file-b", path: "C:/music/b.mp3" })
      const fileA = createLocalFile({ id: "file-a", path: "C:/music/a.mp3" })

      // Act - 执行操作
      await LocalFileService.upsert(fileB)
      await LocalFileService.upsert(fileA)
      const all = await LocalFileService.getAll()

      // Assert - 验证结果
      expect(all.map((item) => item.id)).toEqual(["file-a", "file-b"])
    })

    it("应通过曲目关联返回本地文件并忽略重复关联", async () => {
      // Arrange - 准备数据
      const file = createLocalFile({ id: "file-link" })
      const link = createLocalFileLink(file.id, "track-local")
      await LocalFileService.upsert(file)

      // Act - 执行操作
      await LocalFileService.linkTrack(link)
      await LocalFileService.linkTrack(link)
      const linked = await LocalFileService.getByTrackId("track-local")

      // Assert - 验证结果
      expect(linked.map((item) => item.id)).toEqual([file.id])
    })

    it("应在缺失关联时返回空数组", async () => {
      // Arrange - 准备数据
      await LocalFileService.upsert(createLocalFile({ id: "file-missing-track" }))

      // Act - 执行操作
      const linked = await LocalFileService.getByTrackId("missing-track")

      // Assert - 验证结果
      expect(linked).toEqual([])
    })

    it("应删除本地文件及其关联并允许重复执行", async () => {
      // Arrange - 准备数据
      const file = createLocalFile({ id: "file-delete" })
      await LocalFileService.upsert(file)
      await LocalFileService.linkTrack(createLocalFileLink(file.id, "track-delete"))

      // Act - 执行操作
      await LocalFileService.delete(file.id)
      await LocalFileService.delete("missing-file")
      const all = await LocalFileService.getAll()
      const linked = await LocalFileService.getByTrackId("track-delete")

      // Assert - 验证结果
      expect(all).toEqual([])
      expect(linked).toEqual([])
    })

    it("应在重置本地文件表后保持空结果", async () => {
      // Arrange - 准备数据
      const file = createLocalFile({ id: "file-reset" })
      await LocalFileService.upsert(file)

      // Act - 执行操作
      await LocalFileService.reset()
      await LocalFileService.reset()
      const all = await LocalFileService.getAll()

      // Assert - 验证结果
      expect(all).toEqual([])
    })
  })

  describe("PlaybackQueueService", () => {
    it("应保存当前播放队列并按位置返回队列项", async () => {
      // Arrange - 准备数据
      const queue = createPlaybackQueue({ updatedAt: 100 })
      const second = createPlaybackQueueItem({ position: 1, trackId: "track-2" })
      const first = createPlaybackQueueItem({ position: 0, trackId: "track-1" })

      // Act - 执行操作
      await PlaybackQueueService.saveActiveQueue(queue, [second, first])
      const savedQueue = await PlaybackQueueService.getActiveQueue()
      const items = await PlaybackQueueService.getActiveQueueItems()

      // Assert - 验证结果
      expect(savedQueue?.id).toBe("active")
      expect(items.map((item) => item.trackId)).toEqual(["track-1", "track-2"])
    })

    it("应在保存空队列项时清空旧项", async () => {
      // Arrange - 准备数据
      await PlaybackQueueService.saveActiveQueue(createPlaybackQueue(), [
        createPlaybackQueueItem({ position: 0, trackId: "track-old" }),
      ])

      // Act - 执行操作
      await PlaybackQueueService.saveActiveQueue(createPlaybackQueue({ updatedAt: 200 }), [])
      const items = await PlaybackQueueService.getActiveQueueItems()

      // Assert - 验证结果
      expect(items).toEqual([])
    })

    it("应在未保存队列时返回空结果", async () => {
      // Arrange - 准备数据
      const nothing = true

      // Act - 执行操作
      const queue = await PlaybackQueueService.getActiveQueue()
      const items = await PlaybackQueueService.getActiveQueueItems()

      // Assert - 验证结果
      expect(nothing).toBe(true)
      expect(queue).toBeUndefined()
      expect(items).toEqual([])
    })

    it("应在重置播放队列后保持空结果", async () => {
      // Arrange - 准备数据
      await PlaybackQueueService.saveActiveQueue(createPlaybackQueue(), [
        createPlaybackQueueItem({ position: 0 }),
      ])

      // Act - 执行操作
      await PlaybackQueueService.reset()
      await PlaybackQueueService.reset()
      const queue = await PlaybackQueueService.getActiveQueue()

      // Assert - 验证结果
      expect(queue).toBeUndefined()
    })
  })

  describe("SettingService", () => {
    it("应保存设置并按命名空间读取", async () => {
      // Arrange - 准备数据
      const settingA = createSetting({ namespace: "player", key: "volume" })
      const settingB = createSetting({ namespace: "player", key: "theme" })

      // Act - 执行操作
      await SettingService.upsert(settingA)
      await SettingService.upsert(settingB)
      const saved = await SettingService.get("player", "volume")
      const namespaceSettings = await SettingService.getAllByNamespace("player")

      // Assert - 验证结果
      expect(saved?.key).toBe("volume")
      expect(namespaceSettings).toHaveLength(2)
    })

    it("应覆盖已存在设置并在缺失键时返回空结果", async () => {
      // Arrange - 准备数据
      const setting = createSetting({ namespace: "player", key: "quality", value: { value: "low" } })
      await SettingService.upsert(setting)

      // Act - 执行操作
      await SettingService.upsert({ ...setting, value: { value: "high" } })
      const updated = await SettingService.get("player", "quality")
      const missing = await SettingService.get("player", "missing")

      // Assert - 验证结果
      expect(updated?.value?.value).toBe("high")
      expect(missing).toBeUndefined()
    })

    it("应在重置设置后返回空命名空间结果", async () => {
      // Arrange - 准备数据
      await SettingService.upsert(createSetting({ namespace: "player", key: "reset" }))

      // Act - 执行操作
      await SettingService.reset()
      await SettingService.reset()
      const namespaceSettings = await SettingService.getAllByNamespace("player")

      // Assert - 验证结果
      expect(namespaceSettings).toEqual([])
    })
  })

  describe("ProxySettingsService", () => {
    it("应保存并读取全局代理设置", async () => {
      // Arrange - 准备数据
      const settings = createProxySettings({ host: "10.0.0.1" })

      // Act - 执行操作
      await ProxySettingsService.saveGlobal(settings)
      const saved = await ProxySettingsService.getGlobal()

      // Assert - 验证结果
      expect(saved?.host).toBe("10.0.0.1")
    })

    it("应删除全局代理设置并在缺失时返回空结果", async () => {
      // Arrange - 准备数据
      await ProxySettingsService.saveGlobal(createProxySettings())

      // Act - 执行操作
      await ProxySettingsService.deleteGlobal()
      await ProxySettingsService.deleteGlobal()
      const saved = await ProxySettingsService.getGlobal()

      // Assert - 验证结果
      expect(saved).toBeUndefined()
    })

    it("应保存插件代理设置并返回全部插件配置", async () => {
      // Arrange - 准备数据
      const pluginA = createProxySettings({ host: "10.0.0.2" })
      const pluginB = createProxySettings({ host: "10.0.0.3" })

      // Act - 执行操作
      await ProxySettingsService.savePlugin("plugin-a", pluginA)
      await ProxySettingsService.savePlugin("plugin-b", pluginB)
      const saved = await ProxySettingsService.getPlugin("plugin-a")
      const all = await ProxySettingsService.getAllPlugins()

      // Assert - 验证结果
      expect(saved?.host).toBe("10.0.0.2")
      expect(all).toHaveLength(2)
    })

    it("应删除插件代理设置并在缺失插件时返回空结果", async () => {
      // Arrange - 准备数据
      await ProxySettingsService.savePlugin("plugin-delete", createProxySettings())

      // Act - 执行操作
      await ProxySettingsService.deletePlugin("plugin-delete")
      await ProxySettingsService.deletePlugin("missing-plugin")
      const saved = await ProxySettingsService.getPlugin("plugin-delete")
      const missing = await ProxySettingsService.getPlugin("missing-plugin")

      // Assert - 验证结果
      expect(saved).toBeUndefined()
      expect(missing).toBeUndefined()
    })

    it("应在重置代理设置后清空全局与插件结果", async () => {
      // Arrange - 准备数据
      await ProxySettingsService.saveGlobal(createProxySettings())
      await ProxySettingsService.savePlugin("plugin-reset", createProxySettings())

      // Act - 执行操作
      await ProxySettingsService.reset()
      await ProxySettingsService.reset()
      const global = await ProxySettingsService.getGlobal()
      const plugins = await ProxySettingsService.getAllPlugins()

      // Assert - 验证结果
      expect(global).toBeUndefined()
      expect(plugins).toEqual([])
    })
  })
})
