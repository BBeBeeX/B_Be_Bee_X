# 跨平台音乐播放器插件平台设计

## 1. 目标与约束

本项目是一个使用 TypeScript、Expo React Native 和 Electron 构建的桌面/移动端音乐播放器。播放器本身是插件平台：UI、音乐播放引擎、音乐源（搜索、歌单、歌曲、登录）、音效 DSP、下载、本地文件系统、日志和未来新增能力都以插件形式交付。

### 1.1 目标

- 在 Android、iOS、Windows、macOS、Linux 上共享领域模型和插件协议。
- 核心宿主只负责插件生命周期、能力授权、事件/命令、数据存储和平台桥接，不包含具体音乐产品功能。
- 支持在线源、离线下载和本地文件三种媒体来源，并且可以在同一播放队列中混用。
- 允许多个播放引擎和 DSP 插件共存，运行时选择默认实现。
- 本地优先（local-first），网络不可用时仍可播放已下载内容、浏览本地库和修改本地歌单。
- 插件可独立发布、升级、回滚和迁移数据；一个插件崩溃不能拖垮播放器宿主。

### 1.2 非目标

- 第一阶段不实现跨设备云同步服务；保留同步操作日志和版本字段，后续可添加同步插件。
- 不允许插件绕过宿主直接访问 Node、SQLite、文件系统或原生模块。
- 移动端不加载任意远程 JavaScript。由于 Expo/App Store 约束，动态插件必须是随应用签名发布的代码，或仅包含数据/声明式 UI 的插件。

## 2. 总体架构

```text
┌────────────────────────────── 应用层 ──────────────────────────────┐
│  mobile (Expo RN)                         desktop (Electron)        │
│  RN UI Shell + UI plugins                 renderer UI Shell/plugins │
│  native platform adapters                 preload (窄 IPC API)     │
└───────────────┬───────────────────────────────┬────────────────────┘
                │ Shared Plugin SDK / Contracts │
                └───────────────┬───────────────┘
                        Plugin Kernel (宿主内核)
     lifecycle · capability · command/event bus · state · scheduler
     plugin registry · migrations · RPC · health · configuration
                ┌───────────────┴────────────────┐
                │                                  │
       Platform service adapters            Persistence adapters
  audio · network · FS · secrets          SQLite · blob cache · logs
                │                                  │
       Native/OS services (AVFoundation, ExoPlayer, CoreAudio, etc.)

  plugins/
    ui-*  source-*  playback-*  dsp-*  download-*  filesystem-*  observability-*
```

### 2.1 宿主内核边界

内核（`packages/kernel`）是唯一的系统级依赖注入点，提供以下基础能力：

1. 插件发现、清单校验、依赖排序、激活/停用、升级和回滚。
2. Capability（能力）授权和运行时隔离。
3. 类型化命令总线、事件总线和请求/响应 RPC。
4. 状态存储、数据库事务、迁移、缓存、同步操作日志。
5. 统一的时钟、任务调度器、取消令牌、错误模型和健康检查。
6. 平台适配器注册表，以及桌面端主进程/移动端原生模块之间的窄桥接。
7. 最小日志 API（写入能力）；日志检索、查看、导出由日志插件实现。

内核不包含首页、播放器页面、搜索框、登录页面、下载列表等产品 UI，也不决定使用哪一个音乐源或播放引擎。

### 2.2 插件分类

分类只是清单和依赖解析的辅助，插件可以同时声明多个分类：

| 分类 | 典型职责 | 依赖的服务契约 |
| --- | --- | --- |
| `ui` | 路由、导航项、页面、面板、命令按钮、设置页 | `ui`, `commands`, `events`, `store` |
| `source` | 搜索、歌手/专辑/歌曲、歌单、登录、鉴权刷新、播放地址解析 | `network`, `secrets`, `source` |
| `playback` | 解码、缓冲、队列执行、后台播放、耳机/系统媒体键 | `audio.output`, `events`, `store` |
| `dsp` | EQ、压缩器、混响、响度均衡、音效链 | `audio.processing`, `store` |
| `download` | 解析媒体、分片/断点续传、校验、下载调度、离线可用性 | `network`, `filesystem`, `secrets`, `events` |
| `filesystem` | 本地目录授权、扫描、标签读取、文件变更监听 | `filesystem`, `store` |
| `observability` | 日志查看、诊断、导出、崩溃报告和性能指标 | `logs`, `events`, `filesystem` |
| `sync`（预留） | 远端同步和冲突解决 | `network`, `secrets`, `store.sync` |

推荐首批插件：`ui-shell-default`、`playback-native`、`source-local`、`filesystem-local`、`download-basic`、`dsp-basic`、`observability-log-viewer`。它们仍通过公开契约运行，后续可替换。

## 3. Monorepo 与包边界

建议使用 pnpm workspace + Turborepo（或等价的 TypeScript monorepo 工具）：

```text
apps/
  mobile/                         # Expo RN 应用入口、原生配置、后台任务
  desktop/
    main/                         # Electron 主进程，内核和受保护平台服务
    preload/                      # contextBridge，只暴露版本化 RPC
    renderer/                     # React UI Shell 和 UI 插件宿主
packages/
  contracts/                      # 无副作用的 DTO、命令、事件、错误、schema
  kernel/                         # 插件运行时、总线、权限、生命周期
  plugin-sdk/                     # 插件开发者 API（由 contracts 生成类型）
  plugin-runtime/                 # worker/沙箱/声明式 UI 执行器
  store/                          # SQLite、迁移、repositories、blob store
  ui-shell/                       # 路由、slot、主题、可访问性、资源加载
  platform/                       # Audio/FS/Network/Secrets 等适配器接口
  rpc/                            # Desktop IPC 与 mobile/native bridge 协议
  test-kit/                       # 插件契约测试、fake clock、fake adapters
plugins/
  ui-shell-default/
  playback-native/
  source-local/
  source-*/
  dsp-*/
  download-*/
  filesystem-*/
  observability-*/
tools/
  plugin-cli/                     # create, validate, pack, sign, dev
docs/
```

`contracts` 不依赖 React、Electron、React Native 或 Node，保证可在所有目标端复用。插件只能依赖 `plugin-sdk` 和自己声明的服务契约；禁止反向依赖 `apps/*`。

## 4. 进程、线程与隔离模型

### 4.1 Electron

- **Main 进程**运行 Kernel、Store、网络/文件系统适配器、下载任务和受信任播放插件。所有 Node 能力只在这里出现。
- **Renderer** 只运行 UI Shell 和受信任的 UI 插件，启用 `contextIsolation`、`sandbox`、`nodeIntegration=false`、严格 CSP。
- **Preload** 通过 `contextBridge` 暴露固定的 `host.rpc.request()`、`host.events.subscribe()` 和版本信息；不暴露 `ipcRenderer`、路径、任意函数或 Node 对象。
- 不受信任的 headless 插件在独立 utility process/worker 中运行，经结构化 RPC 与 Kernel 通信；设置 CPU、内存、消息大小和超时配额。
- UI 插件分为受信任（签名并随应用发布，可使用 React 组件）和声明式（JSON schema，运行在通用渲染器）两种。远程安装的代码插件默认只可 headless。

### 4.2 Expo React Native

- RN JS 进程运行 Kernel、Store、插件运行时和 UI Shell；音频、文件、后台任务通过 Expo/原生模块适配器访问。
- 生产构建只包含签名/审核过的代码插件。插件市场可安装 manifest、图标、主题和声明式 UI，但不能下载并 `eval` 新 JS。
- 后台播放与下载使用平台允许的 background service/task；任务状态写入 Store，前台恢复后由事件投影重建。
- 原生模块必须在 `packages/platform` 中封装，插件不直接 import `expo-*` 或平台特定包。

### 4.3 失败隔离

每个插件拥有独立命名空间、取消令牌和健康状态。激活失败只使该插件进入 `failed`，Kernel 继续运行；依赖它的插件收到 `DEPENDENCY_UNAVAILABLE`。连续超时或崩溃触发熔断，保留最近一个可用版本以便回滚。

## 5. 插件清单与生命周期

### 5.1 清单示例

```json
{
  "id": "com.example.source.netease",
  "name": "Netease Source",
  "version": "1.2.0",
  "apiVersion": "1.0",
  "kind": ["source"],
  "entry": { "headless": "dist/index.js", "ui": "dist/ui.js" },
  "platforms": ["android", "ios", "win32", "darwin", "linux"],
  "trust": "signed-headless",
  "permissions": {
    "network": ["music.example.com", "api.example.com"],
    "secrets": ["account_tokens"],
    "audio.output": false,
    "filesystem.read": false
  },
  "dependencies": { "com.example.core.source-api": ">=1.0 <2" },
  "contributes": {
    "routes": ["source/netease", "source/netease/search"],
    "slots": ["library.sources", "search.providers"],
    "commands": ["source.netease.login", "source.netease.logout"]
  },
  "integrity": { "sha256": "...", "signature": "..." }
}
```

`id` 全局唯一且不可复用；版本遵循 SemVer。`apiVersion` 是 SDK 主版本，主版本不兼容时禁止激活。清单校验使用 JSON Schema，安装包使用签名和 SHA-256 校验。

### 5.2 生命周期

```text
discovered -> validated -> permission_pending -> installed
installed -> activating -> active
active -> stopping -> stopped
active -> failed -> (retry | rollback | disabled)
```

插件导出 `createPlugin()`，由 Kernel 注入 `PluginContext`：

```ts
export interface Plugin {
  manifest: PluginManifest;
  activate(ctx: PluginContext): Promise<PluginHandle>;
}

export interface PluginHandle {
  deactivate?(reason: DeactivateReason): Promise<void>;
  health?(): Promise<HealthReport>;
}
```

`activate` 只注册服务、命令、事件处理器和 UI 贡献，不应阻塞等待网络登录。停用时 Kernel 自动取消该插件创建的任务和订阅，并执行资源清理。

## 6. 公共插件协议

### 6.1 Context 与服务

```ts
export interface PluginContext {
  readonly plugin: { id: string; version: string };
  readonly capabilities: CapabilityContext;
  readonly commands: CommandRegistry;
  readonly events: EventBus;
  readonly store: PluginStore;          // 仅访问 plugin_<id> 命名空间
  readonly entities: EntityRepository;  // 通过受限 domain API 读写公共实体
  readonly services: ServiceRegistry;   // source/playback/dsp 等契约
  readonly ui?: UiContributionRegistry;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}
```

插件之间不直接 import 对方的实现，而是通过 `ServiceRegistry` 查找版本化契约。例如下载插件消费 `MediaResolver`，播放插件消费 `PlaybackEngine`，UI 插件消费 `LibraryService`。

### 6.2 命令与事件

- 命令是有权限、可取消、幂等性明确的请求，命名为 `domain.action`，例如 `player.play`、`queue.replace`、`download.pause`。
- 事件是不可变事实，命名为 `domain.event`，例如 `playback.stateChanged`、`download.progressed`、`source.authExpired`。
- 每个命令定义输入/输出 JSON Schema、错误码、幂等键和所需能力；事件带 `eventId`、`occurredAt`、`correlationId`、`producer` 和 `schemaVersion`。
- UI 只发命令并订阅投影事件，不直接修改播放器对象；这样桌面 IPC、移动后台任务和测试都共享同一语义。

```ts
export interface Command<I, O> {
  name: string;
  input: I;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface DomainEvent<T = unknown> {
  eventId: string;
  type: string;
  schemaVersion: number;
  occurredAt: string;
  correlationId?: string;
  producer: string;
  payload: T;
}
```

### 6.3 UI 贡献模型

UI 插件注册路由、slot、命令和设置页，而不是修改 Shell 的组件树：

```ts
ui.routes.register({ id, path, title, icon, component, guard });
ui.slots.register("player.actions", { id, order, render });
ui.commands.register({ name, label, icon, execute });
ui.settings.register({ id, schema, section });
```

标准 slot：`app.nav`、`app.search`、`library.sources`、`library.content`、`player.nowPlaying`、`player.actions`、`queue.header`、`settings.sections`、`download.items`、`diagnostics.panels`。Shell 负责导航、主题、焦点、键盘/无障碍和错误边界，具体内容来自插件。

## 7. 领域服务与关键流程

### 7.1 音乐源插件

```ts
interface MusicSource {
  id: string;
  capabilities: SourceCapabilities;
  search(input: SearchInput): AsyncIterable<SearchPage>;
  getTrack(ref: SourceRef): Promise<TrackResult>;
  getAlbum(ref: SourceRef): Promise<AlbumResult>;
  getPlaylist(ref: SourceRef): Promise<PlaylistResult>;
  resolveMedia(ref: SourceRef, intent: ResolveIntent): Promise<MediaDescriptor[]>;
  auth: AuthProvider;
}
```

搜索结果先写入规范化实体和 `source_item` 映射，再由 UI 订阅分页事件。`resolveMedia` 只返回短期 URL、过期时间和受限请求头，不把凭据写入普通表。登录采用 OAuth PKCE 或源插件定义的设备码流程，token 仅存系统 Keychain/Keystore。

### 7.2 播放流程

```text
UI: player.play(item)
  -> Kernel command bus
  -> QueueService 生成 queue_item / playback_session
  -> SourceResolver 取得 MediaDescriptor
  -> PlaybackEngine.load/play
  -> PlaybackEngine 产生 position/buffer/error 事件
  -> Playback projection 更新 playback_state
  -> UI、下载、日志插件订阅投影
```

播放状态机：`idle -> loading -> ready -> playing <-> paused -> ended`，任意状态可进入 `buffering`、`seeking` 或 `error`；`stop` 回到 `idle`。状态转换由播放插件声明并由 Kernel 校验，不能由 UI 直接写状态。

队列支持 `manual`、`repeat-one`、`repeat-all`、`shuffle`，shuffle 使用持久化 seed 确保应用重启后顺序可恢复。进度每 5 秒或状态变化写入 `playback_progress`，退出时再执行一次同步写入。

### 7.3 下载与离线

下载插件消费 `MediaResolver`，创建 `download_task`，把媒体写入内容寻址的 Blob Store：`blobs/{sha256[0:2]}/{sha256}`。任务状态为 `queued/running/paused/completed/failed/cancelled`，支持断点、并发上限、网络/电量约束和校验。完成后创建 `media_asset(kind=download)`，播放插件优先选择未过期且存在的本地 asset。

### 7.4 DSP

DSP 插件注册 `DspNodeFactory`，节点处理音频帧并声明采样率、声道、延迟和 CPU 预算。`dsp_chain` 只存节点类型和参数，不存可执行代码。播放插件在支持的端把链路编译到原生音频图；不支持某节点时产生 `dsp.nodeUnavailable`，保留原链路并按策略旁路。预设可按设备、输出路由和用户选择覆盖。

### 7.5 本地文件系统

文件系统插件先请求目录权限，扫描任务把文件记录为 `file_asset`，解析器写入 `track/album/artist` 和 `media_asset`。路径只存规范化相对路径与稳定 file key；移动端使用安全书签/URI，不假定 POSIX 路径。删除或移动通过 file watcher/周期扫描产生事件，下载目录由 Download 插件独占。

## 8. 数据与持久化设计

### 8.1 存储分层

```text
SQLite (metadata, queue, settings, task state, event outbox)
  ├─ SQLCipher/keychain-backed encryption where available
  ├─ migrations in packages/store/migrations
  └─ repositories with transaction boundaries
Blob Store (audio, artwork, plugin packages, exports)
  ├─ content-addressed SHA-256
  ├─ cache/download separation
  └─ quota + garbage collection
Secure Store (OS Keychain/Keystore/Credential Vault)
  └─ OAuth tokens, refresh tokens, encryption keys, directory bookmarks
```

数据库时间使用 Unix epoch 毫秒，API 和日志导出使用 UTC ISO-8601/RFC 3339；具体转换规则以 [DATA-API-STATE-SPEC.md](./DATA-API-STATE-SPEC.md) 为准。主键使用 UUIDv7（有序）或等价 ULID；软删除用 `deleted_at`，避免同步和撤销操作丢失上下文。公共表不允许插件随意加列，插件私有数据放在 `plugin_kv` 或插件自己的迁移表中。

### 8.2 核心实体关系

```text
profile ──< source_account >── source_provider
   │              │
   │              └──< source_item >── track/album/artist/playlist
   │
   ├──< playlist ──< playlist_item >── track
   ├──< queue ────< queue_item >────── track
   ├──< playback_session ──< playback_progress >── track
   ├──< download_task >── media_asset ── track
   ├──< favorite >── track/album/artist/playlist
   └──< setting / plugin_kv / log_record

track ──< track_artist >── artist
track ──< album_track >── album
track ──< media_asset (stream | download | local_file)
track/album/artist ──< artwork_ref >── artwork
dsp_chain ──< dsp_chain_node >── dsp_preset
```

### 8.3 表定义（逻辑字段）

以下是实现时必须稳定的字段；具体 SQL 类型由 `packages/store` 适配器决定。

| 表 | 关键字段 | 说明/约束 |
| --- | --- | --- |
| `profile` | `id`, `name`, `is_active`, `created_at`, `updated_at` | 本地用户配置；首版可只有一个 profile |
| `source_provider` | `id`, `plugin_id`, `display_name`, `capabilities_json` | 一个音乐源插件可提供多个 provider |
| `source_account` | `id`, `profile_id`, `provider_id`, `remote_user_id`, `status`, `secret_ref`, `last_sync_at` | `(profile_id, provider_id, remote_user_id)` 唯一；token 只存 `secret_ref` |
| `artist` | `id`, `name`, `sort_name`, `artwork_id`, `metadata_json` | 规范化实体，可被多个来源引用 |
| `album` | `id`, `title`, `sort_title`, `album_type`, `release_date`, `artwork_id`, `metadata_json` | `album_type` 为 album/single/ep/compilation 等 |
| `track` | `id`, `title`, `duration_ms`, `disc_no`, `track_no`, `explicit`, `album_id`, `metadata_json`, `created_at`, `updated_at`, `deleted_at` | 内部规范化歌曲；不把源 URL 当主键 |
| `track_artist` | `track_id`, `artist_id`, `role`, `position` | 主唱、作曲、Featuring 等可扩展角色 |
| `album_track` | `album_id`, `track_id`, `disc_no`, `track_no`, `position` | 处理合辑、再版和多专辑归属；`(album_id, track_id)` 可重复时使用独立版本 ID |
| `source_item` | `id`, `provider_id`, `remote_type`, `remote_id`, `entity_type`, `entity_id`, `etag`, `raw_json`, `last_seen_at` | `(provider_id, remote_type, remote_id)` 唯一；连接远程 ID 与规范化实体 |
| `media_asset` | `id`, `track_id`, `kind`, `uri`, `blob_hash`, `mime`, `size_bytes`, `bitrate`, `sample_rate`, `expires_at`, `availability`, `checksum` | `kind=stream/download/local_file`; 下载/本地必须可校验 |
| `artwork` | `id`, `source_uri`, `blob_hash`, `width`, `height`, `etag`, `expires_at` | 图片同样走 Blob Store；UI 不直接请求任意 URL |
| `artwork_ref` | `id`, `artwork_id`, `entity_type`, `entity_id`, `role`, `position` | 允许一个实体有封面、背景、头像等多个图像；`role` 由契约定义 |
| `playlist` | `id`, `profile_id`, `provider_id`, `source_item_id`, `title`, `description`, `is_smart`, `revision`, `deleted_at` | 本地歌单 `provider_id` 为空 |
| `playlist_item` | `id`, `playlist_id`, `position`, `track_id`, `source_item_id`, `added_by`, `added_at`, `removed_at` | 用稳定 item ID 支持重排和同步，不以 position 作主键 |
| `queue` | `id`, `profile_id`, `name`, `mode`, `shuffle_seed`, `current_item_id`, `revision`, `updated_at` | 默认队列和用户保存队列均可存在 |
| `queue_item` | `id`, `queue_id`, `position`, `track_id`, `media_asset_id`, `source_item_id`, `played_at`, `skipped_at` | `position` 仅为排序值，可使用稀疏整数 |
| `playback_session` | `id`, `profile_id`, `queue_id`, `engine_plugin_id`, `started_at`, `ended_at`, `state`, `error_code` | 每次应用/连续播放过程一个 session |
| `playback_state` | `profile_id`, `session_id`, `status`, `queue_item_id`, `track_id`, `position_ms`, `buffered_ms`, `volume`, `is_muted`, `error_code`, `revision`, `updated_at` | 当前状态投影；可从播放事件重建，`profile_id` 唯一 |
| `playback_progress` | `profile_id`, `track_id`, `position_ms`, `duration_ms`, `completed`, `play_count`, `last_played_at`, `updated_at` | `(profile_id, track_id)` 唯一；幂等 upsert |
| `favorite` | `profile_id`, `entity_type`, `entity_id`, `kind`, `created_at`, `deleted_at` | `entity_type` 可为 track/album/artist/playlist；`(profile_id, entity_type, entity_id, kind)` 唯一 |
| `download_task` | `id`, `profile_id`, `track_id`, `source_item_id`, `status`, `bytes_done`, `bytes_total`, `target_blob_hash`, `error_code`, `retry_count`, `constraints_json`, `created_at`, `updated_at` | `(profile_id, source_item_id)` 可选唯一，避免重复任务 |
| `file_asset` | `id`, `filesystem_plugin_id`, `stable_key`, `relative_uri`, `volume_id`, `size_bytes`, `mtime_ms`, `fingerprint`, `scan_status` | 不存未经授权的绝对路径 |
| `dsp_preset` | `id`, `profile_id`, `name`, `description`, `source_plugin_id`, `parameters_json`, `revision`, `updated_at` | 可由 DSP 插件提供只读预设，也可由用户复制后编辑 |
| `dsp_chain` | `id`, `profile_id`, `name`, `enabled`, `sample_rate_policy`, `revision` | 一个 profile 可有多个链 |
| `dsp_chain_node` | `id`, `chain_id`, `position`, `plugin_id`, `node_type`, `parameters_json`, `bypassed` | 参数由节点 schema 校验 |
| `plugin_installation` | `plugin_id`, `version`, `state`, `trust`, `package_hash`, `installed_at`, `last_error` | 当前安装版本和健康状态 |
| `plugin_permission_grant` | `plugin_id`, `profile_id`, `capability`, `scope_json`, `granted_at`, `revoked_at` | 能力可按 profile 撤销 |
| `plugin_kv` | `plugin_id`, `profile_id`, `key`, `value_json`, `version`, `updated_at` | 私有配置/小型状态；大对象放 Blob Store |
| `setting` | `profile_id`, `namespace`, `key`, `value_json`, `updated_at` | namespace 必须是宿主或插件 ID |
| `log_record` | `id`, `occurred_at`, `level`, `plugin_id`, `category`, `message`, `context_json`, `trace_id` | append-only；敏感字段先脱敏 |
| `outbox_event` | `id`, `event_type`, `schema_version`, `payload_json`, `created_at`, `published_at`, `attempts` | 保证事务提交后可靠发布事件 |
| `sync_operation` | `id`, `profile_id`, `entity_type`, `entity_id`, `operation`, `payload_json`, `base_revision`, `created_at`, `applied_at` | 为未来同步插件保留，不等于已实现云同步 |

推荐索引：`source_item(provider_id, remote_type, remote_id)`、`track(title)`、`media_asset(track_id, availability)`、`playlist_item(playlist_id, position)`、`queue_item(queue_id, position)`、`download_task(status, updated_at)`、`log_record(occurred_at, level, plugin_id)`。全文搜索使用 SQLite FTS5（或平台等价物），索引 `track.title/artist.name/album.title/playlist.title`。

### 8.4 事务与一致性

- 命令处理器在一个 SQLite 事务中写实体、修订号和 `outbox_event`，提交后由事件发布器异步投递。
- 投影（例如当前播放状态、下载汇总）可重建；事件处理器必须幂等，按 `eventId` 去重。
- 插件私有迁移按插件版本执行，并且不能锁住全局迁移。迁移失败时该插件不可激活，但不回滚其他插件表。
- Blob GC 只删除没有任何 `media_asset/artwork/plugin_installation` 引用且超过保留期的对象；正在下载或导出的对象带租约。

## 9. 权限、安全与隐私

能力命名采用 `domain.action`，例如 `network.request`、`filesystem.read`、`filesystem.write`、`audio.output`、`audio.capture`、`secrets.read`、`notifications.send`、`process.spawn`、`logs.write`。授权流程为“清单声明 -> 用户确认（如需）-> 运行时校验 -> 可撤销记录”。

- 网络按域名和方法白名单限制；来源插件不得访问任意域名。
- OAuth 使用 PKCE，refresh token 和密钥只进入系统安全存储；日志、错误和 `raw_json` 必须执行 PII/Token 脱敏。
- 文件访问使用用户选择的目录/文档 URI；校验路径穿越、符号链接和配额。
- 解码器、DSP 和媒体元数据解析在受限 worker/原生库中运行，设置输入大小和执行超时。
- 插件包签名、hash 校验、CSP、依赖锁定和撤销列表由 Plugin Registry 负责。
- 提供“导出数据”和“删除本地数据”命令，删除前列出下载、凭据、日志和插件数据范围。

## 10. 可观测性与错误模型

所有层使用统一错误结构：`code`（稳定机器码）、`message`（可本地化）、`retryable`、`details`、`causeId`。跨进程请求携带 `traceId/correlationId`，日志插件可按插件、命令、播放 session 和 trace 查询。

Kernel 只提供 `logger.debug/info/warn/error` 写入接口和采样/脱敏策略；`observability-log-viewer` 提供日志列表、过滤、诊断包导出和健康状态。默认保留最近 30 天或 50 MB，用户可配置上限。

## 11. 测试与质量门槛

1. `contracts`：JSON Schema、命令/事件兼容性和反序列化黄金文件测试。
2. `test-kit`：fake clock、fake store、fake audio/network/FS adapter，插件契约测试必须通过。
3. Kernel：生命周期、权限、依赖排序、迁移、事件 outbox、崩溃恢复和幂等命令测试。
4. 播放：状态机属性测试、seek/暂停/断网/后台/耳机事件和队列恢复测试。
5. 平台适配器：Android/iOS 原生音频会话、桌面媒体键、路径权限和后台下载的端到端测试。
6. UI：每个 slot/route 的渲染、键盘/屏幕阅读器、窄屏布局和错误边界测试。
7. 发布前对插件包执行签名、依赖漏洞扫描、许可证检查、包大小和启动时间预算。

## 12. 分阶段落地

### Phase 0：契约和宿主骨架

建立 monorepo、`contracts`、Plugin Manifest schema、Kernel 生命周期、事件/命令总线、SQLite 迁移框架和 desktop/mobile 空壳。先用 fake adapters 运行契约测试。

### Phase 1：可播放的最小产品

实现 `ui-shell-default`、`playback-native`、`source-local`、`filesystem-local`，完成本地扫描、规范化实体、队列、后台/桌面基础控制和进度保存。

### Phase 2：在线源与下载

实现一个 OAuth 音乐源插件、SourceResolver、`download-basic`、Blob Store、断点续传、离线选择和来源错误恢复。

### Phase 3：DSP 与可观测性

实现 `dsp-basic` 的 EQ/预设、输出路由适配、日志查看/导出、插件健康页、诊断包和资源配额。

### Phase 4：插件分发与同步预留

实现 registry、签名/撤销、桌面 sandbox worker、移动端签名插件清单、插件升级/回滚；再评估 `sync` 插件和跨设备冲突策略。

## 13. 关键架构决策

- **所有功能插件化，但基础机制内核化**：没有事件、存储、权限和平台桥，插件无法可靠互操作；这些机制不表现为用户功能。
- **规范化实体 + source_item 映射**：避免同一首歌因不同来源产生重复 Track，同时保留源特有字段和鉴权上下文。
- **命令/事件优先于共享可变对象**：桌面 IPC、移动后台和崩溃恢复需要可序列化、可重放的边界。
- **移动端代码插件签名随应用发布，桌面端才开放沙箱动态插件**：满足平台分发政策，同时保留桌面生态的可扩展性。
- **SQLite 元数据与内容寻址 Blob 分离**：数据库迁移轻量、下载可校验、缓存可回收，也便于未来同步元数据而不上传音频文件。
