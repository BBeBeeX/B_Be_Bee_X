# Waterfall Hooks & Typed Event Map

> **Legacy Reference:** Formerly `docs/07-data-model.md §5`.

## 5. The event map

Declared once in `@BBeBee/protocol` by augmenting Cordis's `Events` interface. The dispatch mode is
part of the contract: it determines whether a listener can block, transform, or veto.

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
    /** The task list changed in a way the four above do not describe. */
    'download/changed'(): void

    // library / scanning
    'library/changed'(kind: 'track' | 'album' | 'artist' | 'playlist', urns: string[]): void
    /** A collection was created, renamed, deleted or re-membered (no URN, no kind). */
    'library/collections-changed'(): void
    'scan/started'(specifiedDirId: string): void
    'scan/progress'(specifiedDirId: string, done: number, total?: number): void
    'scan/finished'(specifiedDirId: string, summary: { added: number; updated: number; errors: number }): void

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

> ⚠️ A waterfall listener's `next` is closed over the original arguments and **ignores anything
> passed to it**. Rewrite by mutating the argument in place, or short-circuit by returning without
> calling `next`. The signatures above are written `next: () => …` for that reason.

| Event group | Mode | Why |
|---|---|---|
| `player/before-resolve`, `player/before-enqueue`, `http/request`, `dsp/build-chain` | **waterfall** | Listeners transform the value and control whether the chain continues. The composition mechanism of [02 §5](../architecture/layers.md#5-composition-how-features-reach-each-other) |
| `*/changed`, `*/progress`, `player/*`, `plugin/*` | **emit** | Notification. Listener errors must not affect the emitter |
| `player/track-completed` | **parallel** | Scrobblers, stats, and history all run; all are awaited; one failing does not block the others |
| `source/auth-expired` | **serial** | Ordered handling — the session refresher gets first refusal before the UI prompts |
| `source/signed-out` | **parallel** | Every listener purging session-derived state is awaited, so sign-out completes only once the cleanup has actually finished |
| `source/imported`, `source/changed`, `source/removed` | **emit** | Notification. The runtime rebuilds the affected fibers; views re-render |
| `source/rule-failed` | **emit**, coalesced per source | One rotted source can fail a rule per track in a queue; the badge needs the fact, not the volume |
| `player/position` | **emit**, throttled to 1 Hz | At 60 Hz it would dominate the event bus for no benefit; the UI interpolates between ticks |

---

