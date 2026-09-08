# @BBeBee/kernel

BBeBee 内核模块 — Layer 1，基于 Cordis 构建，提供应用生命周期、配置管理、插件加载、能力门控和数据库迁移等核心功能。

## 概述

`@BBeBee/kernel` 是 BBeBee 音乐播放器的核心模块，负责管理整个应用的启动、配置和插件系统。它封装了 Cordis 框架，并扩展了 BBeBee 特有的功能，如能力门控、数据库迁移和测试工具。

## 核心功能

### 1. 应用引导 (Bootstrap)

**路径**: `src/bootstrap/app.ts`

负责应用的启动和关闭流程，包括：

- **`createApp()`**: 创建应用实例，管理核心服务插件和功能插件的加载
- **`BootstrapError`**: 核心服务启动失败时的错误类
- **`App`** 接口: 提供 `start()`, `stop()`, `ready()` 等方法

**关键特性**:
- 核心服务插件在功能插件之前加载
- 支持优雅关闭，避免单个插件阻塞整个关闭过程
- 提供超时机制，防止插件初始化挂起

### 2. 配置管理 (Config)

**路径**: `src/config/config.ts`

处理应用配置文档，将配置展开为插件激活列表：

- **`resolveConfig()`**: 验证并展开配置文档
- **`isEnabled()`**: 检查插件是否启用
- **`AppConfig`** 接口: 配置文档结构
- **`ResolvedPlugin`** 接口: 单个插件激活信息

**配置结构**:
```typescript
{
  plugins: {
    "plugin-id": {
      enabled: true,
      config: { /* 插件配置 */ }
    }
  }
}
```

### 3. 插件加载器 (Loader)

**路径**: `src/loader/loader.ts`

静态插件加载器，处理插件的实例化和生命周期：

- **`loadPlugins()`**: 实例化所有已解析的插件
- **`PluginRegistry`** 类型: 代码生成步骤输出的插件注册表
- **`LoadedPlugin`** 接口: 加载结果，包含状态和错误信息

**插件状态**:
- `active`: 已加载并运行
- `pending`: 已加载但等待依赖服务
- `failed`: 加载失败
- `quarantined`: 连续失败后被隔离
- `missing`: 配置但未在注册表中找到
- `ungranted`: 未授权的能力请求

### 4. 能力门控 (Capability Gate)

**路径**: `src/capability-gate/capability.ts`

每个插件在能力受限的上下文中运行，确保它们只能访问被授权的资源：

- **`scopeContext()`**: 创建插件的能力受限上下文
- **`capabilityConfigOf()`**: 读取服务拦截的能力配置
- **断言函数**: `assertFs()`, `assertHost()`, `assertDb()` 等

**能力类型**:
- `fs:read:<scope>` / `fs:write:<scope>`: 文件系统访问
- `net:host/<glob>`: 网络访问
- `db:own`: 数据库自有表
- `db:read:<ns>` / `db:write:<ns>` / `db:*:<ns>`: 数据库访问
- `secrets:own`: 密钥存储
- `audio`, `notify`, `shell`, `background`: 系统功能

**SQL 门控**:
- **`sql.ts`**: SQL 语句分析和验证
- **`statementsOf()`**: 分割 SQL 语句
- **`assertSingleStatement()`**: 确保单条语句
- **`assertSqlAllowed()`**: 验证 SQL 是否被允许

### 5. 数据库迁移 (Migrations)

**路径**: `src/migrations/runner.ts`

前向、命名空间化的数据库迁移系统：

- **`MigrationRunner`**: 迁移执行器
- **`nsPrefix()`**: 将命名空间转换为表前缀
- **`expandNs()`**: 替换 SQL 中的 `{{ns}}` 占位符
- **`MigrationError`** / **`NamespaceCollisionError`**: 错误类

**核心表**:
- `schema_migrations`: 记录已应用的迁移版本
- `schema_namespaces`: 记录命名空间所有权

**核心迁移** (`core.ts`):
- **版本 1**: 初始架构，包含提供商、目录、播放列表、下载等表
- **版本 2**: 全文搜索 (FTS5)
- **版本 3**: ADR-5 迁移，将 `providers` 重命名为 `sources`

### 6. 纤维状态 (Fiber State)

**路径**: `src/fiber-state.ts`

Cordis 纤维状态的镜像，解决 TypeScript 兼容性问题：

**状态类型**:
- `PENDING`: 等待依赖
- `LOADING`: 初始化中
- `ACTIVE`: 运行中
- `FAILED`: 启动失败
- `DISPOSED`: 已销毁
- `UNLOADING`: 卸载中

**工具函数**:
- `fiberStateName()`: 获取可读状态名
- `isActive()` / `isSettled()`: 状态检查

### 7. 测试工具 (Testing)

**路径**: `src/testing.ts`

测试辅助工具，特别是用于检测插件泄漏：

- **`snapshotContext()`**: 捕获上下文快照
- **`diffSnapshots()`**: 比较两个快照的差异
- **`expectNoLeak()`**: 断言插件卸载后无泄漏
- **`tick()`**: 等待 Cordis 计划任务完成
- **`createTestContext()`**: 创建空测试上下文
- **`tempDir()`**: 创建临时目录（自动清理）

## 使用示例

### 创建应用实例

```typescript
import { createApp } from '@BBeBee/kernel'

const app = createApp({
  target: 'desktop',
  bootstrap: [coreFsPlugin, coreDbPlugin],
  registry: pluginRegistry,
  config: appConfig,
})

await app.start()
```

### 插件能力声明

```json
{
  "name": "plugin-scrobble",
  "capabilities": ["db:own", "net:host/api.last.fm"]
}
```

### 测试插件泄漏

```typescript
import { expectNoLeak } from '@BBeBee/kernel/testing'

await expectNoLeak(ctx, () => ctx.plugin(MyPlugin, config))
```

## 依赖关系

- **`@BBeBee/protocol`**: 协议定义和服务接口
- **`cordis`**: 基础 DI 和插件框架 (版本 `4.0.0-rc.9`)

## 导出结构

### 插件表面 (Plugin Surface)
对所有层开放，用于类型化插件：
- `Context`, `Service`, `Inject`
- `Plugin`, `Fiber`, `Effect`, `EffectMeta`
- `FiberState`, `fiberStateName`, `isActive`, `isSettled`

### 引导表面 (Bootstrap Surface)
仅对 Layer 2 和组合根开放：
- `createApp`, `BootstrapError`
- `resolveConfig`, `isEnabled`
- `loadPlugins`
- 能力门控函数
- `MigrationRunner`, 迁移相关

## 相关文档

- `docs/01-overview.md`: 项目概述
- `docs/02-architecture.md`: 架构设计
- `docs/03-plugin-system.md`: 插件系统
- `docs/07-data-model.md`: 数据模型和迁移规范
