# 项目架构（ARCHITECTURE）

> 本文是项目架构总览和入口文档。更细的设计见 [music-player-platform-architecture.md](./music-player-platform-architecture.md)。

## 1. 项目定位

B_Be_Bee_X 是一个桌面 + 移动端全平台音乐播放器：

- 移动端：Expo React Native（Android / iOS）
- 桌面端：Electron（Windows / macOS / Linux）
- 语言：TypeScript
- 架构形态：**插件平台**。宿主只提供插件生命周期、命令/事件总线、能力授权、存储、调度和平台桥接；UI、音乐播放、音乐源（搜索/歌单/歌曲/登录）、音效 DSP、下载、本地文件系统、日志等业务能力全部由插件提供。

## 2. 总体架构

```text
┌────────────────────────────── 应用层 ──────────────────────────────┐
│  apps/mobile (Expo RN)                   apps/desktop (Electron)   │
│  UI Shell + UI 插件                      主进程/Preload/Renderer    │
│  native platform adapters                窄 IPC API                │
└───────────────┬───────────────────────────────┬────────────────────┘
                │   Shared Plugin SDK / contracts │
                └───────────────┬───────────────┘
                         Plugin Kernel（宿主内核）
   lifecycle · capability · command/event bus · state · scheduler
   plugin registry · migrations · RPC · health · configuration
                ┌───────────────┴────────────────┐
                │                                  │
       Platform service adapters            Persistence adapters
  audio · network · FS · secrets          SQLite · blob cache · logs
                │                                  │
       Native/OS services (AVFoundation, ExoPlayer, CoreAudio, ...)

  plugins/
    ui-*  source-*  playback-*  dsp-*  download-*  filesystem-*  observability-*
```

## 3. 核心设计原则

1. **机制内核化，功能插件化**：内核不包含任何具体音乐产品功能，只提供插件可靠互操作所需的事件、存储、权限和平台桥。
2. **命令/事件优先于共享可变对象**：UI 只发送命令、订阅事件投影，不直接修改播放器对象。命令可幂等、可取消；事件是不可变事实。
3. **规范化实体 + source_item 映射**：同一首歌被不同音乐源引用时映射到同一个内部 track，避免重复。
4. **本地优先**：元数据 SQLite + 内容寻址 Blob Store；断网时可播放已下载内容和本地库。
5. **分层隔离**：插件不直接访问 Node/SQLite/文件系统/原生模块；所有能力通过版本化服务契约和授权访问。
6. **移动端安全约束**：生产构建只包含签名/审核过的代码插件；移动端不加载任意远程 JS。

## 4. Monorepo 结构

```text
apps/
  mobile/                         # Expo RN 应用入口、原生配置、后台任务
  desktop/
    main/                         # Electron 主进程：内核 + 受保护平台服务
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
  source-*/                       # 在线音乐源插件
  dsp-*/                          # 音效 DSP 插件
  download-*/
  filesystem-*/
  observability-*/
tools/
  plugin-cli/                     # create, validate, pack, sign, dev
docs/
```

包边界：插件只能依赖 `plugin-sdk` 和声明的服务契约，禁止反向依赖 `apps/*`；`contracts` 不依赖 React、Electron、React Native 或 Node。

## 5. 插件分类

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

推荐首批插件：`ui-shell-default`、`playback-native`、`source-local`、`filesystem-local`、`download-basic`、`dsp-basic`、`observability-log-viewer`。

## 6. 插件清单与生命周期

插件通过 JSON Manifest 声明身份、入口、平台、权限、依赖和 UI 贡献；安装时校验签名与 SHA-256。生命周期：

```text
discovered -> validated -> permission_pending -> installed
installed -> activating -> active
active -> stopping -> stopped
active -> failed -> (retry | rollback | disabled)
```

插件导出 `createPlugin()`，在 `activate(ctx)` 中注册命令、事件处理器和 UI 贡献。Kernel 注入 `PluginContext`，提供 `commands/events/store/entities/services/ui/scheduler/logger`，所有跨插件交互都通过 `ServiceRegistry` 的版本化契约进行。

## 7. 关键流程

```text
播放:  UI player.play(item) -> Kernel 命令总线 -> QueueService
       -> SourceResolver 取得 MediaDescriptor -> PlaybackEngine.load/play
       -> 产生 position/buffer/error 事件 -> 投影更新 playback_state
下载:  Download 插件消费 MediaResolver -> download_task
       -> Blob Store (blobs/{sha256[0:2]}/{sha256}) -> media_asset(kind=download)
DSP:   DspNodeFactory 注册节点 -> dsp_chain 只存节点类型和参数
       -> 播放插件编译到原生音频图；不支持的节点旁路并告警
本地:  目录授权 -> 扫描 file_asset -> 解析 tag -> track/album/artist -> media_asset
```

## 8. 数据与持久化

- SQLite：元数据、队列、设置、任务状态、事件 outbox；支持加密与迁移。
- Blob Store：音频、图片、插件包、导出文件；内容寻址 + 配额 + GC。
- Secure Store：OAuth token、密钥、目录书签，仅存 OS Keychain/Keystore。
- 核心实体：`profile / source_provider / source_account / artist / album / track / source_item / media_asset / playlist / queue / playback_session / playback_progress / download_task / file_asset / dsp_chain / plugin_installation / log_record / outbox_event` 等。

## 9. 安全与隔离

- Electron：`contextIsolation` + `sandbox` + `nodeIntegration=false` + 严格 CSP；Preload 只暴露 `host.rpc.request()` 和 `host.events.subscribe()`。
- RN：生产构建只含签名代码插件；远程插件只能是 manifest/图标/主题/声明式 UI。
- 网络按域名白名单；OAuth 用 PKCE；文件访问经用户授权目录；解码器/媒体解析在受限 worker/原生库。
- 插件崩溃只使自身进入 `failed`，内核继续运行；支持健康检查、熔断和回滚。

## 10. 落地阶段

- **Phase 0**：monorepo 骨架、contracts、Manifest schema、Kernel 生命周期、命令/事件总线、SQLite 迁移框架。
- **Phase 1**：可播放最小产品（本地扫描、队列、播放、后台/桌面控制、进度保存）。
- **Phase 2**：在线音乐源插件、下载、Blob Store、断点续传、离线选择。
- **Phase 3**：DSP EQ/预设、日志查看/导出、插件健康页、资源配额。
- **Phase 4**：插件分发、签名/撤销、桌面沙箱 worker、移动端签名插件清单、同步预留。

## 11. 详细设计

更完整的插件协议、表结构、事务规则、权限模型、错误模型和测试门槛见：

- [docs/music-player-platform-architecture.md](./music-player-platform-architecture.md)

数据库、API 和状态管理的具体实现规范见：

- [docs/DATA-API-STATE-SPEC.md](./DATA-API-STATE-SPEC.md)
