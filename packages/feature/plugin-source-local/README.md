# @BBeBee/plugin-source-local

Layer 4（feature）— 本机文件作为 `MediaProvider`：与其他源毫无特权的平等一员。

## 概述

本地库**刻意不受优待**：它走与其他服务器完全相同的 SPI、相同的 URN 方案、相同的 resolve 路径。唯一不同的方法是 `resolveStream`——它对 `kind: 'local'` 立即应答。这也正是 M3 的下载插件能"在播放器毫不知情的情况下"插入的原因：一条下载来的 track 与本地 track 同形、只是 `media_bindings.origin` 不同。

它的 `auth` 是平凡实现 `NoAuth`（`flow: 'none'`），四行——恰恰证明了"要求每个 provider 都实现 auth"的成本是零（docs/06 §1.1）。

**与 `plugin-local-scanner` 的分工**：扫描器负责**填充**（从磁盘把文件变成目录条目），本包负责**应答**（回答目录里有什么、如何播放）。写入者与应答者分离，读写同一批表（docs/06 §8）。

## 源文件

### `src/index.ts`

包内唯一源文件：`SourceLocal` 服务、`NoAuth`、能力常量与插件入口。

**`SourceLocal extends Service`**（占用 `ctx.sourceLocal` 服务键；`static inject = ['db', 'fs', 'sources']`）：

| 成员 | 作用 |
|---|---|
| `[Service.init]()` | 嵌套注入 `['scanner']`（拿扫描根列表，缺失只是功能降级）；向 `ctx.sources.register(this.provider())` 注册 provider——注册本身就是 disposer，卸载插件或登出都会让下游"看不见"它。⚠️ disposer 包在本地闭包里再返回：穿过 service proxy 的不是 fiber 会收集的那个函数。启动时 `logger.info` 一行注册日志——"我的本地音乐不见了"必须能从日志文件回答。 |
| `provider(): MediaProvider` | 组装交给 `ctx.sources` 的 provider 对象。 |

**必需核心面**：

- `getTrack(id)` — 直查该 URN 的行。早期版本先列整个目录第一页再回退，是"每首歌两次查询"的浪费——这是播放器逐曲调用的路径。
- `getTracks(ids)` — 批量版。SPI 有这个成员的全部理由：`ids.map(getTrack)` 是 N 次往返，而队列恢复一次就要整条队列。
- `resolveStream(id, prefs)` — **URN 变成字节的一刻，也是唯一与远程 provider 不同的方法**。查 `media_bindings` 拿文件、`ctx.fs.exists` 校验（文件没了要按播放器分支的错误分类报 `NotFoundError`，而不是拖到解码时失败）、`ctx.fs.toPlayableUri` 收尾——这是 **Android SAF 泄漏的显式化**：用户选择的文件夹是解码器打不开的 `content://` 树 URI，就在这里变成能打开的东西（docs/04 §1）。产物带 `codec`/`bitrateKbps`/`sampleRate`/`byteLength`。
- `ping()` — 便宜（按契约）：根存在且可读即可。

**可选面**：

- `search(query, page)` — 应答自 `ctx.sources` 维护的 FTS 索引（按本 sourceId 收窄）。一个索引两个入口（这里与 `searchLocal`），而不是两套会漂移的分词配置。能力常量里 `fullText: true` 因此成立——本包自己不建索引。
- `browse(nodeId?, page?)` — 本地库的"探索"面就是文件夹树。目录来自 `ctx.fs`；**文件只有被扫描器真正导入过才是叶子**——一整个不支持的文件的目录浏览为空，而不是一堆播不了的 track。性能：整个文件夹两条查询（`scan_entries` 的 uri→urn 批量映射 + tracks 批量读），300 首的目录曾是 600 次往返。读目录失败**先写日志再抛**：抛错只是用户没在看的那块屏幕上的消息，"哪个文件夹读不了"才是全部诊断——SAF 权限被吊销和 U 盘被拔在 UI 上长得一模一样。
- `getAlbum` / `getArtist` — 委托 `ctx.sources` 的目录 hydrate。
- `getArtwork(id)` — 封面已在磁盘上，id 就是知道位置的那一行（`artworks.local_uri`）。

**登出 = `forgetEverything()`**：没有凭据，所以清除的是目录行与扫描簿记（`scan_entries`/`media_bindings`/`tracks`/`albums`/`artists`，一个事务），本地等价于清 cookie jar；**文件本身是用户的，绝不触碰**。随后 emit `library/changed` 与 `source/signed-out`。

**能力常量 `CAPABILITIES`**：search（tracks + fullText）、browse、artwork、library.read、streaming `{ qualities: ['lossless'], seekable: true, urlExpiry: false }`——"磁盘上的文件永远可 seek、永不过期"，说出来 UI 才能不试探就给出拖动条。

## 配置

```ts
export interface SourceLocalConfig {
  sourceId?: string    // 默认 'local'，必须与扫描器的一致
  displayName?: string // 默认 'This device'
}
```

## 能力声明

`fs:read:all`、`db:read:core`、`db:write:core`。

## 导出

```ts
export class SourceLocal extends Service      // ctx.sourceLocal
export interface SourceLocalConfig
export const name = 'plugin-source-local'
export async function apply(ctx, config?)     // 刻意 await ctx.plugin(SourceLocal, config)
export default { name, apply }
export { parseUrn }
```

## 相关文档

- `docs/06-music-sources.md` §1/§8：MediaProvider SPI、本地源的平等地位
- `docs/04-core-services.md` §1：`ctx.fs.toPlayableUri` 与 SAF
- `packages/feature/plugin-local-scanner/README.md`：写入端
