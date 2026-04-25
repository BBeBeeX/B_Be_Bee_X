import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PluginAccountService } from "../src/services/pluginAccount"
import {
  PluginCredentialService,
  setPluginCredentialEncryptionSecret,
} from "../src/services/pluginCredential"
import { PluginRegistryService } from "../src/services/pluginRegistry"
import { PluginSessionService } from "../src/services/pluginSession"
import {
  createPluginAccount,
  createPluginCredentials,
  createPluginRegistryMetadata,
  createPluginSession,
} from "./support/factories"
import { createTestDatabase, destroyTestDatabase, type TestDatabaseContext } from "./support/testDb"

describe("database 插件服务", () => {
  let context: TestDatabaseContext

  beforeEach(() => {
    context = createTestDatabase()
    setPluginCredentialEncryptionSecret("test-secret")
  })

  afterEach(() => {
    destroyTestDatabase(context)
  })

  describe("PluginSessionService", () => {
    it("应保存插件会话并支持按插件读取", async () => {
      // Arrange - 准备数据
      const session = createPluginSession({ pluginId: "plugin-session-a" })

      // Act - 执行操作
      await PluginSessionService.upsert(session)
      const saved = await PluginSessionService.getByPluginId(session.pluginId)
      const all = await PluginSessionService.getAll()

      // Assert - 验证结果
      expect(saved?.pluginId).toBe(session.pluginId)
      expect(all).toHaveLength(1)
    })

    it("应覆盖已存在插件会话并在缺失插件时返回空结果", async () => {
      // Arrange - 准备数据
      const session = createPluginSession({ pluginId: "plugin-session-update", isLoggedIn: false })
      await PluginSessionService.upsert(session)

      // Act - 执行操作
      await PluginSessionService.upsert({ ...session, isLoggedIn: true })
      const updated = await PluginSessionService.getByPluginId(session.pluginId)
      const missing = await PluginSessionService.getByPluginId("missing-plugin")

      // Assert - 验证结果
      expect(updated?.isLoggedIn).toBe(true)
      expect(missing).toBeUndefined()
    })

    it("应删除插件会话并在重置后保持空结果", async () => {
      // Arrange - 准备数据
      const session = createPluginSession({ pluginId: "plugin-session-delete" })
      await PluginSessionService.upsert(session)

      // Act - 执行操作
      await PluginSessionService.deleteByPluginId(session.pluginId)
      await PluginSessionService.deleteByPluginId("missing-plugin")
      await PluginSessionService.reset()
      await PluginSessionService.reset()
      const all = await PluginSessionService.getAll()

      // Assert - 验证结果
      expect(all).toEqual([])
    })
  })

  describe("PluginAccountService", () => {
    it("应保存插件账号并按插件读取", async () => {
      // Arrange - 准备数据
      const accountA = createPluginAccount({ id: "account-a", pluginId: "plugin-account", accountId: "a1" })
      const accountB = createPluginAccount({
        id: "account-b",
        pluginId: "plugin-account",
        accountId: "a2",
        isDefault: true,
      })

      // Act - 执行操作
      await PluginAccountService.upsert(accountA)
      await PluginAccountService.upsert(accountB)
      const all = await PluginAccountService.getAllByPluginId("plugin-account")
      const defaultAccount = await PluginAccountService.getDefaultByPluginId("plugin-account")

      // Assert - 验证结果
      expect(all).toHaveLength(2)
      expect(defaultAccount?.accountId).toBe("a2")
    })

    it("应覆盖已存在插件账号并在缺失默认账号时返回空结果", async () => {
      // Arrange - 准备数据
      const account = createPluginAccount({
        id: "account-update",
        pluginId: "plugin-account-update",
        accountId: "a1",
        profile: { label: "旧名称" },
      })
      await PluginAccountService.upsert(account)

      // Act - 执行操作
      await PluginAccountService.upsert({
        ...account,
        profile: { label: "新名称" },
      })
      const updated = await PluginAccountService.getAllByPluginId("plugin-account-update")
      const missing = await PluginAccountService.getDefaultByPluginId("missing-plugin")

      // Assert - 验证结果
      expect(updated[0]?.profile?.label).toBe("新名称")
      expect(missing).toBeUndefined()
    })

    it("应删除插件账号并在重置后保持空结果", async () => {
      // Arrange - 准备数据
      const account = createPluginAccount({ id: "account-delete", pluginId: "plugin-account-delete" })
      await PluginAccountService.upsert(account)

      // Act - 执行操作
      await PluginAccountService.delete(account.id)
      await PluginAccountService.delete("missing-account")
      await PluginAccountService.reset()
      await PluginAccountService.reset()
      const all = await PluginAccountService.getAllByPluginId(account.pluginId)

      // Assert - 验证结果
      expect(all).toEqual([])
    })
  })

  describe("PluginCredentialService", () => {
    it("应加密保存插件凭据并按插件读取", async () => {
      // Arrange - 准备数据
      const credentials = createPluginCredentials({ token: "token-a" })

      // Act - 执行操作
      await PluginCredentialService.upsert("plugin-credential-a", credentials)
      const saved = await PluginCredentialService.getByPluginId("plugin-credential-a")
      const all = await PluginCredentialService.getAll()

      // Assert - 验证结果
      expect(saved?.token).toBe("token-a")
      expect(all).toHaveLength(1)
    })

    it("应保存账号级凭据并支持按账号读取", async () => {
      // Arrange - 准备数据
      const credentials = createPluginCredentials({ token: "token-account" })

      // Act - 执行操作
      await PluginCredentialService.upsert("plugin-credential-b", credentials, "account-1")
      const saved = await PluginCredentialService.getByAccount("plugin-credential-b", "account-1")

      // Assert - 验证结果
      expect(saved?.token).toBe("token-account")
    })

    it("应覆盖已存在插件凭据并在缺失凭据时返回空结果", async () => {
      // Arrange - 准备数据
      await PluginCredentialService.upsert("plugin-credential-update", createPluginCredentials({ token: "old" }))

      // Act - 执行操作
      await PluginCredentialService.upsert("plugin-credential-update", createPluginCredentials({ token: "new" }))
      const updated = await PluginCredentialService.getByPluginId("plugin-credential-update")
      const missingPlugin = await PluginCredentialService.getByPluginId("missing-plugin")
      const missingAccount = await PluginCredentialService.getByAccount("plugin-credential-update", "missing-account")

      // Assert - 验证结果
      expect(updated?.token).toBe("new")
      expect(missingPlugin).toBeUndefined()
      expect(missingAccount).toBeUndefined()
    })

    it("应删除插件级与账号级凭据", async () => {
      // Arrange - 准备数据
      await PluginCredentialService.upsert("plugin-credential-delete", createPluginCredentials({ token: "plugin" }))
      await PluginCredentialService.upsert(
        "plugin-credential-delete",
        createPluginCredentials({ token: "account" }),
        "account-1",
      )

      // Act - 执行操作
      await PluginCredentialService.deleteByAccount("plugin-credential-delete", "account-1")
      await PluginCredentialService.deleteByAccount("plugin-credential-delete", "missing-account")
      await PluginCredentialService.deleteByPluginId("plugin-credential-delete")
      await PluginCredentialService.deleteByPluginId("missing-plugin")
      const all = await PluginCredentialService.getAll()

      // Assert - 验证结果
      expect(all).toEqual([])
    })

    it("应在重置凭据表后保持空结果", async () => {
      // Arrange - 准备数据
      await PluginCredentialService.upsert("plugin-credential-reset", createPluginCredentials())

      // Act - 执行操作
      await PluginCredentialService.reset()
      await PluginCredentialService.reset()
      const all = await PluginCredentialService.getAll()

      // Assert - 验证结果
      expect(all).toEqual([])
    })
  })

  describe("PluginRegistryService", () => {
    it("应保存插件注册信息并支持读取与筛选启动插件", async () => {
      // Arrange - 准备数据
      const enabled = createPluginRegistryMetadata({ id: "plugin-enabled", state: "enabled" })
      const disabled = createPluginRegistryMetadata({ id: "plugin-disabled", state: "disabled" })

      // Act - 执行操作
      await PluginRegistryService.upsert(enabled)
      await PluginRegistryService.upsert(disabled)
      const saved = await PluginRegistryService.get(enabled.id)
      const all = await PluginRegistryService.list()
      const startup = await PluginRegistryService.listEnabledForStartup()

      // Assert - 验证结果
      expect(saved?.id).toBe(enabled.id)
      expect(all).toHaveLength(2)
      expect(startup.map((item) => item.id)).toEqual([enabled.id])
    })

    it("应覆盖插件注册信息并在缺失插件时返回空结果", async () => {
      // Arrange - 准备数据
      const metadata = createPluginRegistryMetadata({ id: "plugin-update", state: "enabled" })
      await PluginRegistryService.upsert(metadata)

      // Act - 执行操作
      await PluginRegistryService.upsert({ ...metadata, state: "running" })
      const updated = await PluginRegistryService.get(metadata.id)
      const missing = await PluginRegistryService.get("missing-plugin")

      // Assert - 验证结果
      expect(updated?.state).toBe("running")
      expect(missing).toBeUndefined()
    })

    it("应更新插件状态并记录错误状态", async () => {
      // Arrange - 准备数据
      const metadata = createPluginRegistryMetadata({ id: "plugin-state", state: "enabled" })
      await PluginRegistryService.upsert(metadata)

      // Act - 执行操作
      await PluginRegistryService.setState(metadata.id, "running")
      await PluginRegistryService.recordError(metadata.id, {
        message: "boom",
        occurredAt: 123,
        phase: "run",
      })
      await PluginRegistryService.setState("missing-plugin", "disabled")
      await PluginRegistryService.recordError("missing-plugin", {
        message: "ignored",
        occurredAt: 456,
        phase: "load",
      })
      const saved = await PluginRegistryService.get(metadata.id)

      // Assert - 验证结果
      expect(saved?.state).toBe("error")
      expect(saved?.lastError?.message).toBe("boom")
    })

    it("应删除插件注册信息并在重置后保持空结果", async () => {
      // Arrange - 准备数据
      const metadata = createPluginRegistryMetadata({ id: "plugin-delete" })
      await PluginRegistryService.upsert(metadata)

      // Act - 执行操作
      await PluginRegistryService.delete(metadata.id)
      await PluginRegistryService.delete("missing-plugin")
      await PluginRegistryService.reset()
      await PluginRegistryService.reset()
      const all = await PluginRegistryService.list()

      // Assert - 验证结果
      expect(all).toEqual([])
    })
  })
})
