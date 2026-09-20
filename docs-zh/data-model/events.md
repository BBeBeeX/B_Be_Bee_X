# 瀑布流钩子与强类型事件映射表

> **历史章节映射：** 原 `docs-zh/07-data-model.md §5`。

## 5. 事件表

在 `@BBeBee/protocol` 中通过扩充 Cordis 的 `Events` 接口一次性声明。派发模式是契约的一部分：它决定了监听器能否阻塞、变换或否决这次派发。

```ts
declare module 'cordis' {
  interface Events {
    // player — emit
    'player/state-changed'(state: TransportState): void
    'player/track-changed'(trackUrn: string | undefined, previous?: string): void
    'player/position'(positionMs: number, durationMs: number): void
    'player/track-completed'(play: PlayRecord): void
    'player/error'(error: SourceError, trackUrn: string): void

    // player — waterfall (interception points)
    'player/before-resolve'(urn: string, prefs: StreamPrefs, next: () => Promise<StreamHandle>): Promise<StreamHandle>
    'player/before-enqueue'(urns: string[], next: (u: string[]) => void): void

    // queue — emit
    'queue/changed'(items: readonly QueueItem[]): void

    // sources — registration and session
    'source/registered'(sourceId: string): void
    'source/unregistered'(sourceId: string): void
    'source/authenticated'(sourceId: string, status: AuthStatus): void
    'source/auth-expired'(sourceId: string): void
    'source/unreachable'(sourceId: string, error: SourceError): void
    /** Sign-out completed. Listeners purge anything derived from that session. */
    'source/signed-out'(sourceId: string): void

    // sources — the document itself (06 §9, §10)
    'source/imported'(sourceIds: string[]): void
    'source/changed'(sourceId: string, changedFields: string[]): void
    'source/removed'(sourceId: string, forgotCatalogue: boolean): void
    /** A rule produced nothing where something was required. Drives the stale badge. */
    'source/rule-failed'(sourceId: string, rule: { block: string; field: string }): void
    'source/checked'(sourceId: string, report: CheckReport): void

    // http — waterfall
    'http/request'(req: HttpRequest, next: (r: HttpRequest) => Promise<HttpResponse>): Promise<HttpResponse>

    // downloads — emit
    'download/queued'(taskId: string): void
    'download/progress'(taskId: string, done: number, total?: number): void
    'download/completed'(taskId: string, bindingId: string): void
    'download/failed'(taskId: string, error: Error): void

    // library / scanning
    'library/changed'(kind: 'track' | 'album' | 'artist' | 'playlist', urns: string[]): void
    'scan/started'(rootId: string): void
    'scan/progress'(rootId: string, done: number, total?: number): void
    'scan/finished'(rootId: string, summary: { added: number; updated: number; errors: number }): void

    // dsp
    'dsp/build-chain'(segments: EffectSegment[], next: (s: EffectSegment[]) => EffectSegment[]): EffectSegment[]
    'dsp/chain-changed'(chain: DspService['chain']): void

    // plugins
    'plugin/loaded'(id: string): void
    'plugin/failed'(id: string, error: Error): void
    'plugin/unloaded'(id: string): void
  }
}
```

> ⚠️ 瀑布式监听器收到的 `next` 闭包捕获的是最初传入的参数，并且**忽略任何传给它的东西**。要改写值，就原地修改参数；要短路，就不调用 `next` 直接返回。上面的签名正是因此才写成 `next: () => …`。

| 事件组 | 模式 | 理由 |
|---|---|---|
| `player/before-resolve`、`player/before-enqueue`、`http/request`、`dsp/build-chain` | **waterfall** | 监听器变换传入的值，并决定链条是否继续。这正是 [02 §5](../architecture/layers.md#5-组合功能之间如何触达彼此) 所述的组合机制 |
| `*/changed`、`*/progress`、`player/*`、`plugin/*` | **emit** | 通知。监听器抛出的错误不得影响发出方 |
| `player/track-completed` | **parallel** | scrobble、统计与历史记录全部执行；全部被 await；其中一个失败不阻塞其余 |
| `source/auth-expired` | **serial** | 按序处理 —— 会话刷新器拥有第一处理权，之后才轮到 UI 出面提示 |
| `source/signed-out` | **parallel** | 每个清除会话派生状态的监听器都被 await，因此登出只有在清理真正完成之后才算结束 |
| `source/imported`、`source/changed`、`source/removed` | **emit** | 通知。运行时重建受影响的 fiber；视图随之重渲染 |
| `source/rule-failed` | **emit**，按音源合并 | 一个腐烂的音源能让一个队列里的每首曲目都各失败一次规则；徽标需要的是事实本身，而不是它的量 |
| `player/position` | **emit**，节流到 1 Hz | 若按 60 Hz 派发，它会毫无收益地霸占事件总线；UI 在两次节拍之间自行插值 |

---

