# 数据库、API 与状态管理规范

本文是 B_Be_Bee_X 音乐播放器的实现规范，约束所有宿主和插件。架构总览见 [ARCHITECTURE.md](./ARCHITECTURE.md)，完整平台设计见 [music-player-platform-architecture.md](./music-player-platform-architecture.md)。

## 1. 适用范围与不可违反的规则

本规范覆盖：

- SQLite 元数据数据库、Blob Store、Secure Store 的边界和数据一致性。
- 插件服务 API、命令/事件总线、Electron IPC、移动端 Native Bridge 的协议。
- Kernel、领域 Store、UI Store 和临时任务状态的分层与更新规则。

必须遵守以下规则：

1. API 的输入、输出、命令和事件必须有可版本化的 JSON Schema；TypeScript 类型由 Schema 生成或与 Schema 做兼容性测试。
2. UI 只能发送命令和读取状态投影，不得直接调用数据库、原生模块或修改领域状态对象。
3. 数据库写入必须经过 repository/command handler；插件不得执行宿主公共表的任意 SQL。
4. 事件是不可变事实，命令是可审计请求；不能用“广播一个可变对象”代替事件。
5. 所有跨进程请求都必须可序列化、可取消、可设置超时，并携带 `requestId` 和 `traceId`。
6. 迁移、命令处理、事件消费和状态更新都必须支持幂等或明确声明不可幂等的原因。

## 2. 数据库设计规范

### 2.1 存储分层与职责

```text
SQLite
  元数据、关系、队列、设置、任务状态、事件 outbox、状态投影

Blob Store
  音频文件、封面、插件包、诊断包和导出文件
  内容寻址：blobs/{sha256 前两位}/{sha256}

Secure Store
  OAuth access/refresh token、数据库密钥、目录 bookmark、设备密钥
  只允许通过 secrets API 访问，禁止落入 SQLite、日志或事件 payload
```

平台适配器统一暴露 `MetadataStore`、`BlobStore`、`SecureStore` 接口。桌面端默认 SQLite + SQLCipher（可用时），移动端使用经过封装的 SQLite 实现；上层 repository 不依赖具体数据库驱动。

### 2.2 命名、类型与通用字段

- 表名和列名使用 `snake_case`；TypeScript DTO 使用 `camelCase`，只在 repository 边界转换。
- 主键使用 UUIDv7 或 ULID 字符串；禁止使用自增 ID 作为跨端/同步标识。
- 数据库时间统一使用 Unix epoch 毫秒 `INTEGER`；API、日志导出和调试界面统一使用 UTC RFC 3339。转换只发生在 repository/API 边界。
- 布尔值使用 `0/1`（SQLite）并在 DTO 转换为 `boolean`。
- JSON 列后缀为 `_json`，必须经过 Schema 校验；禁止把可查询的核心字段只放在 JSON 中。
- 数值明确单位和范围，字段名带 `_ms`、`_bytes`、`_hz` 等单位后缀。
- 所有可变公共实体至少包含 `created_at`、`updated_at`、`revision`；可删除实体使用 `deleted_at` 软删除。
- 所有文本使用 UTF-8；搜索排序不能依赖 SQLite 默认二进制排序，应由 `sort_key` 或 FTS 配置明确。

### 2.3 公共表与插件私有表

公共表由 `packages/store` 维护迁移，插件只能通过领域 repository 访问。插件数据按以下顺序选择存储：

| 数据类型 | 存储位置 | 示例 |
| --- | --- | --- |
| 可被其他插件引用的领域实体 | 公共表 | `track`、`playlist`、`media_asset` |
| 仅插件自身的小型配置 | `plugin_kv` | API 筛选项、上次分页游标 |
| 插件可查询的大型结构 | 插件命名空间表 | 搜索缓存、源特有映射 |
| 二进制或大型文本 | Blob Store | 封面、下载音频、诊断包 |
| 凭据和密钥 | Secure Store | refresh token、目录授权书签 |

插件私有表必须使用前缀 `p_<plugin_id_slug>__`，并通过插件迁移注册；不得创建名为 `track`、`queue` 等公共表。

### 2.4 核心约束

- `source_item(provider_id, remote_type, remote_id)` 唯一，远程 ID 不得直接作为内部实体主键。
- `track_artist(track_id, artist_id, role, position)`、`album_track(album_id, track_id, disc_no, track_no)` 必须有唯一或业务等价约束。
- `playlist_item` 和 `queue_item` 使用稳定 item ID；`position` 只是排序值，重排不能依赖数组下标作为身份。
- `media_asset.blob_hash` 指向 Blob Store 时必须存在引用租约或数据库引用；数据库提交和 Blob 引用登记不能产生孤儿对象。
- `playback_state` 是可重建投影，不作为播放事实来源；播放事实必须来自 `playback.*` 事件和 `playback_session`。
- `download_task` 状态变更、进度和 `media_asset` 创建必须通过同一个领域命令流程，完成任务必须可验证 checksum。
- `source_account.secret_ref` 只能引用 Secure Store 的键名，不允许存 token 本身。

### 2.5 事务边界与 Outbox

所有产生领域事实的命令按以下顺序执行：

```text
校验输入/权限
  -> 开启 SQLite 事务
  -> 写入实体和 revision
  -> 写入 outbox_event（同一事务）
  -> 提交事务
  -> Outbox publisher 发布事件
  -> 标记 published_at；失败则指数退避重试
```

规则：

- 事件发布失败不能回滚已经提交的领域写入；消费者必须支持重复事件。
- `outbox_event.id` 即事件 `eventId`，发布器使用 `(eventId, consumerId)` 去重。
- Durable consumer 必须在同一事务中更新投影并插入 `processed_event`；任一步失败都回滚，避免“已标记消费但投影未更新”。
- 事务内禁止网络请求、文件下载、等待音频硬件或调用 UI。
- 需要长时间执行的操作只在事务中创建任务和状态，不在事务中执行任务本身。

以下基础表属于宿主内核，不允许插件直接写入：

| 表 | 关键字段 | 约束与用途 |
| --- | --- | --- |
| `schema_migrations` | `scope`, `version`, `checksum`, `applied_at`, `duration_ms` | `(scope, version)` 唯一；记录宿主和插件迁移 |
| `outbox_event` | `id`, `event_type`, `schema_version`, `aggregate_id`, `sequence`, `payload_json`, `created_at`, `published_at`, `attempts`, `next_attempt_at` | 领域事务内写入；`id` 全局唯一 |
| `processed_event` | `consumer_id`, `event_id`, `processed_at` | `(consumer_id, event_id)` 唯一，用于 durable consumer 去重 |
| `idempotency_record` | `actor_id`, `command_type`, `idempotency_key`, `request_hash`, `status`, `response_json`, `expires_at` | 三元组唯一；相同 key 不同 payload 返回 `IDEMPOTENCY_CONFLICT` |
| `pending_command` | `id`, `profile_id`, `type`, `schema_version`, `payload_json`, `idempotency_key`, `base_revision`, `status`, `attempts`, `next_attempt_at`, `last_error_json` | 保存允许离线重放的命令；凭据不得进入 payload |

`idempotency_record` 在命令执行前创建为 `running`，成功后保存脱敏结果；进程崩溃后由 handler 根据领域状态判定继续、补偿或返回先前结果。记录默认保留 7 天，金融或授权类操作可配置更长时间。

### 2.6 迁移规范

迁移文件命名为 `YYYYMMDDNN_description.sql` 或等价的单调序号，包含 `up` 和可选的 `down` 信息。每次启动执行：

1. 锁定 migration runner，读取 `schema_migrations`。
2. 在单独事务执行待迁移版本。
3. 写入版本、校验和、执行时间。
4. 失败则阻止使用受影响的 repository，并保留数据库供诊断；不得静默跳过。

插件迁移与宿主迁移分开记录为 `host:<version>`、`plugin:<id>:<version>`。破坏性变更采用“增加新列/双写/回填/切换/删除旧列”多阶段策略，不能在一个版本中直接丢失用户数据。

### 2.7 分页、查询和缓存

- 大列表 API 默认使用 cursor 分页，不使用可能因插入而漂移的 offset 分页。
- cursor 是签名或不可篡改的 Base64URL JSON，至少包含排序字段、实体 ID、`revision` 和过期时间。
- 默认排序必须稳定，例如 `updatedAt DESC, id DESC`；客户端不得自行拼接 SQL 排序。
- 搜索走 FTS 索引；详情查询通过 repository 预加载所需关联，禁止 N+1 查询。
- 内存缓存是可丢弃的；SQLite 是元数据事实来源，领域状态投影可从事件/实体重建。

### 2.8 SQLite 运行参数

每个数据库连接必须启用并验证以下设置：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

执行删除、迁移或导入前运行 `PRAGMA foreign_key_check`。应用不得长期持有写事务；批量扫描每批最多写入固定数量记录并主动让出事件循环。移动端在适配器支持时于进入后台前 checkpoint WAL，以缩短恢复时间并控制 WAL 文件大小。

## 3. API 规范

### 3.1 API 类型与边界

系统使用三种 API，统一复用 `packages/contracts`：

| 类型 | 用途 | 传输 |
| --- | --- | --- |
| Domain Command API | 修改状态、启动任务、控制播放 | Kernel bus、Electron IPC、RN bridge |
| Query API | 读取实体和状态投影 | 本地 service、IPC、RN bridge |
| Domain Event API | 发布事实、驱动投影和 UI | Event bus、IPC subscription、后台恢复 |

可选的远程同步/插件注册服务使用 HTTP JSON；它不能成为本地播放的必需依赖。

### 3.2 命名与版本

- 命令、查询和事件使用点分命名；段名以小写字母开头，可使用 lowerCamelCase：`player.play`、`queue.replace`、`download.pause`、`playback.stateChanged`。
- Query 使用资源名和动词：`library.tracks.list`、`playlist.get`、`settings.get`。
- `apiVersion` 遵循 SemVer；不兼容变更必须递增主版本。消息的 `schemaVersion` 是从 1 开始单调递增的整数，每次 Schema 变化都递增，是否向后兼容由契约 diff 检查决定。
- 一个命令只有一个 owner；插件通过清单声明注册的命令不能覆盖已存在的命令。
- 所有字符串 ID 使用 opaque ID，客户端不能从 ID 推断路径、用户或权限。

### 3.3 请求信封

```ts
export interface RequestEnvelope<T> {
  protocol: "music-host/1";
  requestId: string;          // UUIDv7
  traceId: string;
  actor: { type: "user" | "plugin" | "system"; id: string };
  sentAt: string;             // RFC 3339 UTC
  timeoutMs?: number;
  idempotencyKey?: string;
  type: string;               // command or query name
  schemaVersion: number;
  payload: T;
}
```

`requestId` 只标识一次传输；`idempotencyKey` 标识一次业务意图。客户端重试命令时必须复用 `idempotencyKey`，但生成新的 `requestId`。

`actor` 由宿主根据当前会话、插件运行上下文和 capability grant 注入。Renderer、插件或远程客户端提供的 actor 字段只能作为声明，不能覆盖宿主认证结果。

### 3.4 响应信封与错误

```ts
type ResponseEnvelope<T> = ResponseBase & (
  | { ok: true; data: T }
  | { ok: false; error: ApiError }
);

interface ResponseBase {
  protocol: "music-host/1";
  requestId: string;
  traceId: string;
  receivedAt: string;
}

export interface ApiError {
  code: string;             // 稳定机器码，例如 PLAYER_NOT_READY
  message: string;          // 可展示但不可作为判断条件
  retryable: boolean;
  category: "validation" | "permission" | "conflict" | "not_found" |
    "unavailable" | "rate_limit" | "offline" | "invalid_state" |
    "timeout" | "internal";
  details?: Record<string, unknown>;
  causeId?: string;
}
```

客户端只能根据 `code`、`category` 和 `retryable` 做分支。`message` 支持本地化，不能被当作稳定协议。

标准错误码：

| 错误码 | 场景 | 默认处理 |
| --- | --- | --- |
| `INVALID_ARGUMENT` | Schema 或业务校验失败 | 修正请求，不重试 |
| `PERMISSION_DENIED` | 插件能力未授权 | 请求授权或隐藏操作 |
| `NOT_FOUND` | 实体、任务或插件不存在 | 刷新查询 |
| `CONFLICT` | revision/幂等键冲突 | 重新读取并提示合并 |
| `IDEMPOTENCY_CONFLICT` | 相同幂等键对应不同 payload | 生成新的业务意图和 key |
| `DEPENDENCY_UNAVAILABLE` | 依赖插件/服务不健康 | 等待健康事件或降级 |
| `SOURCE_AUTH_REQUIRED` | 音乐源需要登录/刷新 | 启动认证流程 |
| `MEDIA_UNAVAILABLE` | 无可用媒体 asset | 显示下载/重试入口 |
| `RATE_LIMITED` | 源或服务限流 | 按 `retryAfterMs` 退避 |
| `OFFLINE_UNAVAILABLE` | 当前命令不支持离线执行 | 等待网络恢复，不排队 |
| `INVALID_STATE_TRANSITION` | 当前领域状态不允许操作 | 刷新状态并禁用无效操作 |
| `TIMEOUT` | 请求超过 deadline | 仅幂等请求可自动重试 |
| `INTERNAL_ERROR` | 未分类内部错误 | 展示 traceId，记录日志 |

### 3.5 命令规范

命令定义必须包含输入/输出 Schema、owner、所需能力、超时、幂等策略、错误码和产生的事件。示例：

```ts
type PlayerPlayInput = {
  queueItemId?: string;
  trackId?: string;
  startPositionMs?: number;
  reason: "user" | "autoplay" | "resume" | "system";
  expectedQueueRevision?: number;
};

type PlayerPlayOutput = {
  sessionId: string;
  queueItemId: string;
  acceptedAt: string;
};

declareCommand({
  name: "player.play",
  owner: "playback",
  input: PlayerPlayInputSchema,
  output: PlayerPlayOutputSchema,
  capability: "audio.output",
  idempotency: "keyed",
  timeoutMs: 5000,
  emits: ["playback.loadStarted", "playback.stateChanged"]
});
```

播放、暂停、seek、队列替换、下载控制等命令必须通过命令总线。命令成功只代表请求被接受或完成，最终播放状态以事件投影为准。

### 3.6 查询规范

```ts
type ListTracksQuery = {
  filter?: { text?: string; sourceId?: string; downloaded?: boolean };
  cursor?: string;
  limit?: number; // 1..100，默认 30
  sort?: "recent" | "title" | "artist";
};

type Page<T> = {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
  snapshotRevision: number;
};
```

查询必须返回 DTO，不返回 SQLite row、Blob 内部路径、Secure Store 引用或插件实例。媒体播放 URL 必须通过 `media.resolve` 获取短期 descriptor，不能由 `track` 查询直接返回。

### 3.7 事件规范

```ts
export interface EventEnvelope<T> {
  protocol: "music-host/1";
  eventId: string;
  traceId: string;
  correlationId?: string;
  type: string;
  schemaVersion: number;
  producer: string;
  aggregateId?: string;
  sequence?: number;
  delivery: "durable" | "lossy";
  occurredAt: string;
  payload: T;
}
```

事件规则：

- 事件名描述已经发生的事实或结果：`download.completed`、`source.authExpired`、`playback.error`；不得使用 `download.completeNow` 这类命令式名称。
- 事件 payload 是事实快照，发布后不可修改；纠正事实要发布新事件。
- 高频事件（播放位置、下载进度）必须声明 `delivery: lossy`，不能写入 outbox 的每一帧；周期性 checkpoint 写入数据库。
- 关键事件（登录状态、下载完成、播放错误、插件状态）使用 `delivery: durable`，必须走 outbox。
- 订阅者必须能处理重复、乱序和未知字段；需要顺序时按 aggregate key（如 `sessionId`、`downloadTaskId`）排序。
- 同一 `aggregateId` 的 durable 事件使用单调递增 `sequence`；发现缺口时消费者暂停该 aggregate，并重新读取投影或请求补发。

### 3.8 Electron IPC 与移动端 Bridge

两者都实现同一个 `Transport` 接口：

```ts
interface Transport {
  request<TReq, TRes>(request: RequestEnvelope<TReq>): Promise<ResponseEnvelope<TRes>>;
  subscribe<T>(filter: EventFilter, handler: (event: EventEnvelope<T>) => void): Unsubscribe;
}
```

- Electron Preload 只暴露 `host.request`、`host.subscribe`、`host.getInfo`；不暴露 Node、路径、`ipcRenderer` 或任意函数。
- Bridge 必须限制消息大小（默认 1 MiB）、请求超时和订阅数量；大文件通过 Blob API 分片传输。
- 断开连接时订阅自动失效；客户端重连后使用 `sinceEventId` 或查询投影恢复，不假设事件未丢失。
- 播放控制等高频操作可以走专用低延迟通道，但状态仍必须回写到统一事件/投影。

### 3.9 HTTP JSON（可选远程服务）

如启用远程同步或插件 Registry，使用以下约定：

- `Content-Type: application/json`，响应带 `X-Request-Id`、`X-Trace-Id`。
- URL 使用 `/api/v1/...`；不在 URL 中携带 token，使用标准 Authorization header。
- `GET` 查询可重试；`POST/PATCH/DELETE` 必须使用 `Idempotency-Key` 或显式声明不可重试。
- 使用 `ETag`/`If-Match` 做 revision 控制，冲突返回 `409 CONFLICT`。
- 分页、错误 envelope、时间、ID 和字段兼容规则与本地 API 完全一致。

### 3.10 核心 API 目录

首个稳定协议版本至少定义以下 API。插件可扩展，但不能改变这些名称和语义：

| 领域 | Commands | Queries | Durable Events |
| --- | --- | --- | --- |
| 播放 | `player.play`, `player.pause`, `player.stop`, `player.seek`, `player.setVolume` | `playback.state.get`, `playback.session.get` | `playback.loadStarted`, `playback.stateChanged`, `playback.trackChanged`, `playback.ended`, `playback.error` |
| 队列 | `queue.replace`, `queue.append`, `queue.remove`, `queue.move`, `queue.setMode` | `queue.current.get`, `queue.items.list` | `queue.replaced`, `queue.itemAdded`, `queue.itemRemoved`, `queue.itemMoved`, `queue.modeChanged` |
| 音乐库 | `library.favorite.set`, `playlist.create`, `playlist.update`, `playlist.delete`, `playlist.items.replace` | `library.tracks.list`, `track.get`, `album.get`, `artist.get`, `playlists.list`, `playlist.get` | `library.favoriteChanged`, `playlist.created`, `playlist.updated`, `playlist.deleted`, `playlist.itemsChanged` |
| 来源 | `source.login.begin`, `source.login.complete`, `source.logout`, `source.sync.start` | `sources.list`, `source.account.get`, `source.search`, `source.entity.get` | `source.accountChanged`, `source.authExpired`, `source.syncStarted`, `source.syncCompleted`, `source.syncFailed` |
| 媒体 | `media.resolve`, `media.cache.evict` | `media.assets.list`, `media.availability.get` | `media.assetCreated`, `media.assetUnavailable`, `media.cacheEvicted` |
| 下载 | `download.enqueue`, `download.pause`, `download.resume`, `download.cancel`, `download.remove` | `downloads.list`, `download.get` | `download.queued`, `download.started`, `download.paused`, `download.completed`, `download.failed`, `download.removed` |
| DSP | `dsp.chain.select`, `dsp.chain.update`, `dsp.node.bypass` | `dsp.chains.list`, `dsp.chain.get`, `dsp.presets.list` | `dsp.chainChanged`, `dsp.nodeUnavailable`, `dsp.processingFailed` |
| 插件 | `plugin.install`, `plugin.enable`, `plugin.disable`, `plugin.permission.set`, `plugin.rollback` | `plugins.list`, `plugin.get`, `plugin.health.get` | `plugin.installed`, `plugin.stateChanged`, `plugin.permissionChanged`, `plugin.failed` |

高频 lossy 事件单独定义为 `playback.positionChanged`、`playback.bufferChanged` 和 `download.progressChanged`。它们不能被业务逻辑当作唯一完成依据；完成与失败必须有 durable 事件。

## 4. 状态管理规范

### 4.1 状态分层

```text
┌────────────────────────────────────────────┐
│ UI Local State                              │
│ 输入框、弹窗、焦点、临时排序、动画           │
├────────────────────────────────────────────┤
│ Query Cache / Server Projection             │
│ tracks、playlists、插件列表、分页结果         │
├────────────────────────────────────────────┤
│ Domain Store                                │
│ queue、playback_state、downloads、auth state │
├────────────────────────────────────────────┤
│ Kernel Runtime State                        │
│ plugin lifecycle、capability、tasks、health  │
└────────────────────────────────────────────┘
```

- **UI Local State** 只存在于组件或 UI store，不持久化，不发布领域事件。
- **Query Cache** 是可失效缓存；网络/SQLite 查询结果进入这里，不能被当作写入事实。
- **Domain Store** 保存跨页面、跨进程和需要恢复的业务状态，所有写入通过 command handler。
- **Kernel Runtime State** 由宿主维护，插件只能通过查询 API 读取有限投影。

推荐实现：React 端使用 Zustand/Redux Toolkit 之一作为适配层，领域 store 只暴露 `dispatch(command)`、`select(selector)`、`subscribe(listener)`；具体库不是协议的一部分。

领域状态必须按 owner 分片：

| Slice | Owner | 持久化 | 更新来源 |
| --- | --- | --- | --- |
| `playback` | 当前 playback 插件 | `playback_state` checkpoint | `playback.*` 事件 |
| `playbackClock` | UI Shell | 不持久化 | lossy position/buffer 事件和本地时钟插值 |
| `queue` | Kernel QueueService | `queue`, `queue_item` | `queue.*` 事件 |
| `library` | LibraryService | 规范化实体表 | 查询结果和 `library.*` 事件 |
| `downloads` | download 插件 | `download_task` | `download.*` 事件 |
| `accounts` | source/auth 服务 | `source_account`，凭据除外 | `source.accountChanged`, `source.authExpired` |
| `plugins` | Kernel PluginRegistry | `plugin_installation`, permission 表 | `plugin.*` 事件 |
| `settings` | SettingsService | `setting`, `plugin_kv` | `settings.*` 事件 |
| `ui` | UI Shell/页面 | 不持久化或仅保存无敏感偏好 | 组件 action |

同一份数据只能有一个 owner 和一个事实来源。其他 slice 只保存 ID 或派生 selector，不复制可独立修改的实体副本。

### 4.2 单向数据流

```text
用户操作/系统事件
  -> Command
  -> Handler 校验权限和 revision
  -> SQLite transaction + outbox
  -> Domain Event
  -> Reducer/Projection 更新 Domain Store
  -> Query Cache invalidate/update
  -> UI selector 重渲染
```

领域 store 的 reducer 必须是纯函数、可重放、幂等；副作用只能存在于 command handler、effect runner 或 platform adapter。组件不得在 render 阶段发送命令或修改 store。

### 4.3 状态对象规范

公共状态投影包含：

```ts
type StateEnvelope<T> = {
  data: T;
  revision: number;
  updatedAt: string;
  source: "local" | "remote" | "replayed";
  stale: boolean;
  error?: ApiError;
};
```

所有异步状态至少能表达 `idle`、`loading`、`ready`、`refreshing`、`error`，长任务还要表达 `queued`、`running`、`paused`、`completed`、`cancelled`。禁止用 `undefined` 同时表示“未加载”“不存在”和“加载失败”。

播放状态使用有限状态机：

```text
idle -> loading -> ready -> playing <-> paused -> ended
                  │          │  │
                  └──────────┴──┴──> error
playing/paused -> buffering -> playing/paused
playing/paused -> seeking -> playing/paused
任何状态 --stop--> idle
```

非法转换必须返回 `INVALID_STATE_TRANSITION`，不得由 UI 强行覆盖。`positionMs` 高频更新在内存中节流显示，持久化每 5 秒、暂停、切歌、后台挂起和应用退出时执行。

### 4.4 Store API

```ts
interface DomainStore<S> {
  getState(): Readonly<S>;
  dispatch<C extends CommandName>(command: CommandInput<C>): Promise<CommandResult<C>>;
  select<T>(selector: (state: S) => T): T;
  subscribe<T>(selector: (state: S) => T, listener: (value: T) => void): Unsubscribe;
  hydrate(snapshot?: StoreSnapshot): Promise<void>;
}

interface StoreSnapshot {
  schemaVersion: number;
  lastEventId?: string;
  domains: Record<string, unknown>;
  capturedAt: string;
}
```

推荐根状态只保存规范化引用和领域投影：

```ts
interface RootState {
  playback: PlaybackState;
  playbackClock: PlaybackClockState;
  queue: QueueState;
  downloads: EntityState<DownloadTaskView>;
  accounts: EntityState<AccountAuthView>;
  plugins: EntityState<PluginView>;
  settings: SettingsState;
  pendingMutations: Record<string, PendingMutation>;
}
```

歌曲、专辑、歌手和歌单列表属于 Query Cache，不重复塞入每个页面 slice。实体引用使用 ID，页面通过 memoized selector 组合展示模型。

约束：

- selector 必须返回稳定引用或使用明确 equality 函数，避免播放位置更新导致全 UI 重渲染。
- store 不暴露 `setState` 给 UI；测试可使用受控的 fake adapter 注入初始状态。
- `hydrate` 先加载 SQLite 投影，再订阅事件；若发生竞态，按 `revision`/`eventId` 丢弃旧数据。
- 每个领域 slice 有独立 reducer、事件映射和持久化策略，不建立一个包含所有插件字段的巨型 store。

### 4.5 乐观更新与冲突

只允许对可回滚、低风险操作做乐观更新，例如收藏、队列拖拽和本地歌单编辑。乐观状态必须保存：

```ts
type PendingMutation = {
  mutationId: string;
  commandType: string;
  idempotencyKey: string;
  baseRevision: number;
  optimisticPatch: unknown;
  rollbackPatch: unknown;
  status: "pending" | "confirmed" | "rejected";
};
```

播放实际开始、删除下载、退出账号、权限授予等操作不做乐观成功展示，以服务端/引擎事件为准。收到 `CONFLICT` 时：读取最新实体 -> 运行领域合并策略 -> 生成新命令；不得盲目覆盖别人的 revision。

### 4.6 离线与恢复

- SQLite 是离线事实源；查询优先返回本地投影，并标记 `stale=true`。
- 可离线执行的命令必须进入 `pending_command`/`sync_operation` 队列，带 idempotency key、base revision 和重试次数。
- 不可离线执行的命令立即返回 `OFFLINE_UNAVAILABLE`，UI 不得伪造成功状态。
- 恢复网络后按依赖顺序重放：认证 -> 元数据 -> 歌单/收藏 -> 下载；遇到冲突进入人工可见的冲突队列。
- 应用崩溃重启时：读取最后一个已提交投影 -> 扫描未发布 outbox -> 恢复任务 -> 重新订阅事件；不能从 UI 内存状态恢复。

### 4.7 生命周期与资源清理

Store subscription、下载任务、播放事件和后台任务都必须绑定 `AbortSignal` 或 scope：

```ts
const scope = runtime.createScope("source.search");
scope.signal.addEventListener("abort", () => cancelNetworkRequests());
scope.onDispose(() => queryCache.invalidate("search"));
```

插件停用、路由卸载、账号切换和 profile 删除时必须销毁对应 scope；禁止全局事件订阅引用已卸载的 UI 组件。

### 4.8 敏感状态

Token、目录授权、数据库密钥和原始认证响应不进入 Domain Store、Query Cache、Redux devtools、日志或错误详情。UI 只读取脱敏投影，例如：

```ts
type AccountAuthView = {
  providerId: string;
  status: "loggedOut" | "loggedIn" | "expired" | "needsReauth";
  displayName?: string;
  avatarArtworkId?: string;
  expiresAt?: string;
};
```

### 4.9 测试规范

最低测试集合：

1. Schema 测试：请求、响应、命令、事件的正例、反例和未知字段兼容性。
2. Repository 测试：唯一约束、软删除、事务回滚、迁移、分页 cursor 和 checksum。
3. Handler 测试：权限、revision 冲突、幂等重试、超时和错误映射。
4. Reducer/Projection 测试：重复/乱序事件、崩溃后 hydrate、非法状态转换。
5. Contract 测试：每个插件对声明的服务契约、能力范围和 API 版本执行自动检查。
6. 端到端测试：Electron IPC、RN bridge、后台播放/下载、断网恢复和跨进程重连。

## 5. 推荐目录与代码归属

```text
packages/contracts/
  schemas/                       # JSON Schema，协议事实来源
  commands/                      # command definitions + generated types
  events/                        # event definitions + generated types
  errors.ts
packages/store/
  migrations/
  repositories/
  projections/
  blob/
packages/kernel/
  command-bus/
  event-bus/
  outbox/
  capabilities/
  lifecycle/
packages/state/
  domain-store.ts
  slices/
  selectors/
  query-cache.ts
packages/rpc/
  transport.ts
  electron-preload.ts
  rn-native-bridge.ts
plugins/*/
  src/commands.ts
  src/events.ts
  src/repositories.ts
  src/state.ts
  plugin.manifest.json
```

`contracts/schemas` 是跨端协议的唯一事实来源；代码生成、数据库 DTO、API 文档和契约测试都从它派生。任何只修改 TypeScript 类型而未更新 Schema 的变更都视为不完整。

## 6. 版本与兼容性清单

发布前必须检查：

- 数据库迁移可从支持的最低版本升级，且有备份/恢复测试。
- API 新增字段为可选，枚举新增值不会让旧客户端崩溃；删除/重命名字段需要主版本。
- 事件消费者忽略未知字段和未知事件类型，并保留 `schemaVersion`。
- 命令的幂等行为在重试、断线重连和应用恢复后不变。
- Store snapshot 和事件回放可以在当前版本加载；不兼容时执行显式迁移。
- 插件声明的 API、事件、能力与实际注册内容一致，不能在运行时偷偷扩大权限。
