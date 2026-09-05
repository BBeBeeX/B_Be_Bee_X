/**
 * One imported source, presented as a `MediaProvider`.
 *
 * This is the M1 slice (docs/11 MD-7): a source row, a fiber, a `=` template,
 * and a stream. `ruleStream` is rendered against the stored track payload and
 * the active `StreamPrefs`; everything else in docs/06 — the selector engines,
 * search, explore, login, `@js:` — arrives with the rest of the runtime.
 *
 * The important property even at this size is that `ruleStream` depends only
 * on `{{source.*}}`, `{{track.*}}` and `{{prefs.*}}` — never on state left
 * over from a search. The user plays from their library hours later, offline
 * from whatever produced the track, and resolution must still work.
 */

import {
  AuthError,
  hostAllowedBy,
  NetworkError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  RuleError,
  UnavailableError,
} from '@BBeBee/protocol'
import type {
  AuthFlow,
  BrowseEntry,
  AlbumDetail,
  BrowseResult,
  DebugStep,
  PageRequest,
  SearchQuery,
  SearchResult,
  AuthStatus,
  Capabilities,
  Disposable,
  HttpService,
  JsRealm,
  JsService,
  MediaProvider,
  ProviderAuth,
  SourceRecord,
  StreamHandle,
  Lyrics,
  LyricsFormat,
  StreamPrefs,
  Track,
  TraceEvent,
} from '@BBeBee/protocol'
import { formatUrn } from '@BBeBee/protocol'
import {
  engineAvailable,
  evaluate,
  parseRule,
  type JsEvaluator,
  type RuleTraceEntry,
  type TemplateScope,
} from '@BBeBee/source-rules'
import { evaluateRule, evaluateUrlTemplate } from '@BBeBee/source-rules'
import { capabilitiesFor } from './capabilities.js'
import { SRC_SHIM, createSourceHost } from './host.js'
import { TraceCollector, tracedHttp } from './trace.js'
import { fetchDocument, parseUrlObject } from './fetch.js'
import { evaluateListRule, rowToTrack } from './list-rule.js'

/** What the runtime needs from its context. Kept narrow so tests need no kernel. */
export interface SourceDeps {
  http: HttpService
  /**
   * The sandbox, when the host has one.
   *
   * Optional so a build without `ctx.js` still runs every document that does
   * not need it — which is most of them. A document that *does* reports its
   * affected capabilities as absent rather than offering a button that fails.
   */
  js?: JsService
  /**
   * Persistent per-source values, behind `src.vars`.
   *
   * Credential-grade (docs/06 §3.4): a document keeps its session token here,
   * so it is never exported and is cleared by sign-out.
   */
  vars?: SourceVars
  /**
   * Erase everything this source holds: its jar, its secrets, its vars.
   *
   * Owned by the runtime rather than by the source, because two of the three
   * live in the source's *isolated scope* — the jar belongs to `ctx.http`, the
   * secrets to `ctx.secrets` — and the provider cannot reach them.
   */
  signOut?(): Promise<void>
  /** The track payload a search stored, keyed by track id. */
  trackPayload?(id: string): Promise<Record<string, unknown> | undefined>
  /** The album payload a browse stored. Carries the `childUrl` `getAlbum` fetches. */
  albumPayload?(id: string): Promise<Record<string, unknown> | undefined>
  /**
   * Where a note about a rule that half-worked goes.
   *
   * Optional so a test can construct a source without a context, but supplied
   * in production: a rule dropping rows is the kind of thing that otherwise
   * only shows up as "the search is missing things".
   */
  log?(message: string): void
}

/**
 * Auth synthesised from the document.
 *
 * A document with no login fields is `flow: 'none'` and its two methods are
 * nearly trivial — which is precisely the case that proves requiring `auth` on
 * every provider costs nothing. `variable` is the flow a Subsonic-shaped
 * document uses: the user types one string, and the document decides what it
 * means.
 */
class DocumentAuth implements ProviderAuth {
  readonly flow: AuthFlow
  private explicit: AuthStatus | undefined
  /** The one refresh every caller awaits. See `refresh`. */
  private inFlight: Promise<void> | undefined
  private readonly listeners = new Set<(s: AuthStatus) => void>()

  constructor(
    record: SourceRecord,
    private readonly session: SessionStore,
  ) {
    /*
     * Order matters: a document with `loginUi` is a *form*, even if it also
     * carries a `variableComment` for something else. The form is what the
     * user is shown, and offering a single-line variable box for a two-field
     * login is a screen nobody can complete.
     */
    this.flow = record.doc.loginUi?.length
      ? { kind: 'form', fields: record.doc.loginUi, submitTo: record.doc.loginUrl ?? '' }
      : record.doc.variableComment
        ? { kind: 'variable', comment: record.doc.variableComment }
        : { kind: 'none' }
  }

  /** Called by the runtime when a response says the session is over. */
  markExpired(): void {
    if (this.status.state === 'expired') return
    this.set({ state: 'expired' })
  }

  /**
   * Derived, not snapshotted.
   *
   * ⚠️ A snapshot taken in the constructor is read *before* the persisted
   * variable has loaded, so every restart reported `anonymous` for a source
   * the user had signed into — and the only visible symptom was a sign-in
   * prompt that should not have been there.
   *
   * A `variable` source with no variable is anonymous rather than
   * authenticated: reporting otherwise makes every screen offer content it
   * cannot fetch, and the first failure then reads as a broken backend.
   */
  get status(): AuthStatus {
    if (this.explicit) return this.explicit
    if (this.flow.kind === 'none') return { state: 'authenticated' }
    // A form source keeps its credentials under the field ids it declared, not
    // under `var`. Checking only `var` reported every signed-in form source as
    // anonymous — the same class of bug as reading the status before the vars
    // had loaded, one level down.
    const stored =
      this.flow.kind === 'form'
        ? this.flow.fields.every(
            (field) => field.type === 'checkbox' || this.session.get(field.id) !== undefined,
          )
        : this.session.get('var') !== undefined
    return stored ? { state: 'authenticated' } : { state: 'anonymous' }
  }

  /**
   * Store what the user typed.
   *
   * `input.var` is the one field a `variable` flow has (docs/06 §5). It goes
   * to `source_vars` rather than into the document, so it is never exported
   * with the source and never appears in a trace.
   */
  async signIn(input: Record<string, string> = {}): Promise<void> {
    if (this.flow.kind === 'variable') {
      const variable = input.var ?? input.variable
      if (!variable) {
        throw new AuthError('this source needs its variable set before it can sign in')
      }
      await this.session.put('var', variable)
    } else if (this.flow.kind === 'form') {
      /*
       * Every declared field is stored, then the login request is made. The
       * fields go to the same credential-grade store as the variable, so a
       * password typed into a form is no more exposed than one pasted into a
       * variable box (docs/06 §5).
       */
      for (const field of this.flow.fields) {
        const value = input[field.id]
        // A checkbox that is off sends nothing, and that is a real answer —
        // only a missing text field is a missing credential.
        if (value === undefined && field.type !== 'checkbox') {
          throw new AuthError(`this source needs "${field.label}" to sign in`)
        }
        if (value !== undefined) await this.session.put(field.id, value)
      }
      await this.session.login()
    }
    this.explicit = undefined
    for (const listener of this.listeners) listener(this.status)
  }

  /**
   * Re-run the login, once, however many callers asked.
   *
   * A burst of 401s is the normal shape of an expired session — every request
   * in flight fails at the same moment — and re-authenticating once per
   * failure would hammer the backend with logins and race them against each
   * other. One in-flight promise; everyone awaits it (docs/06 §5).
   */
  async refresh(): Promise<void> {
    if (this.flow.kind !== 'form') {
      // Nothing to re-run: a `variable` source's credentials are static, so an
      // expired session there needs the *user*, not a retry.
      throw new AuthError('this source cannot refresh its own session')
    }
    this.inFlight ??= this.session
      .login()
      .then(() => {
        this.explicit = undefined
        for (const listener of this.listeners) listener(this.status)
      })
      .finally(() => {
        this.inFlight = undefined
      })
    return this.inFlight
  }

  /**
   * Leave nothing behind.
   *
   * ⚠️ The most commonly missed step in the whole design, and the reason it is
   * one call rather than three: the persisted cookie jar, the secrets
   * namespace and `source_vars` all have to go, and forgetting any one of them
   * leaves the user signed in through a route they cannot see.
   */
  async signOut(): Promise<void> {
    await this.session.clear()
    // Cleared, not overridden: with the variable gone the derived answer is
    // already `anonymous`, and an override would survive a later sign-in that
    // wrote a new one.
    this.explicit = undefined
    for (const listener of this.listeners) listener(this.status)
  }

  onStatusChange(cb: (s: AuthStatus) => void): Disposable {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  private set(status: AuthStatus): void {
    this.explicit = status
    for (const listener of this.listeners) listener(status)
  }
}

export class DocumentSource {
  private readonly auth: DocumentAuth
  /** Learned from a HEAD when the document does not say. */
  private seekable: boolean | undefined
  /**
   * The source's realm, created on first use and kept for its lifetime.
   *
   * Kept rather than created per rule because `jsLib` and `src.cache` are
   * *state a document builds*: a token cached during search has to still be
   * there when the stream is resolved. Per-call realms would make `src.cache`
   * a no-op with a plausible name.
   */
  private realm: JsRealm | undefined
  private realmSetup: Promise<JsRealm> | undefined
  private readonly hostCache = new Map<string, unknown>()
  /**
   * Set only while `debug()` runs.
   *
   * On the instance rather than threaded through every call because tracing
   * has to reach *every* evaluation — including the ones inside `renderOptional`
   * and the list rule — and a parameter on each would be forgotten by exactly
   * the one that later turns out to matter.
   */
  private tracing: TraceCollector | undefined

  constructor(
    private readonly record: SourceRecord,
    private readonly deps: SourceDeps,
  ) {
    this.auth = new DocumentAuth(record, {
      get: (key) => deps.vars?.get(key),
      put: async (key, value) => {
        await deps.vars?.put(key, value)
      },
      clear: async () => {
        await deps.signOut?.()
      },
      login: () => this.login(),
    })
    // ⚠️ No rule is evaluated here. `seekable` used to be rendered in the
    // constructor against an empty scope, so a perfectly reasonable document
    // — `seekable: '={{prefs.saveData}}'` — threw a RuleError during
    // construction, which propagated through `startOne` out of `apply` and
    // marked the *whole plugin* FAILED. Every source became unusable, on
    // every boot. A rule is evaluated when it has a scope to be evaluated in.
  }

  get sourceId(): string {
    return this.record.id
  }

  /**
   * Tear down anything this source holds.
   *
   * A realm is a WASM allocation; a source removed or disabled while the app
   * runs must not leave one behind.
   */
  dispose(): void {
    this.realm?.dispose()
    this.realm = undefined
    this.realmSetup = undefined
  }

  /**
   * The evaluator handed to the rule engine, or `undefined` with no sandbox.
   *
   * Its presence is what makes `@js:` an available engine, so a build without
   * `ctx.js` derives capabilities that leave the affected features off rather
   * than offering them and failing (docs/06 §1.3).
   */
  private get js(): JsEvaluator | undefined {
    if (!this.deps.js) return undefined
    return async (expression, scope) => {
      const realm = await this.realmFor()
      /*
       * Wrapped in a function, not evaluated bare.
       *
       * A `@js:` body is an *expression* in every document that exists —
       * `auth()`, `result.map(x => x.id)` — but authors also write multi
       * statement bodies ending in a `return`. Wrapping accepts both: a bare
       * expression becomes the completion value of the arrow, and a body with
       * `return` works because it is a function body.
       */
      return realm.eval(`(async () => { ${bodyOf(expression)} })()`, scope as Record<string, unknown>)
    }
  }

  /**
   * The realm, created once.
   *
   * The in-flight promise is memoised, not just the result: two rules
   * evaluated concurrently would otherwise each build a realm, and the second
   * would silently replace the first — taking `src.cache` and anything `jsLib`
   * had set up with it.
   */
  private realmFor(): Promise<JsRealm> {
    if (this.realm) return Promise.resolve(this.realm)
    this.realmSetup ??= this.buildRealm()
    return this.realmSetup
  }

  private async buildRealm(): Promise<JsRealm> {
    const js = this.deps.js
    if (!js) throw new Error('no js service')

    // Before the realm exists, so `src.vars.get` — which cannot await — has
    // its values by the time any script can call it.
    await this.deps.vars?.load?.()

    const realm = await js.createRealm()
    const host = createSourceHost({
      http: this.deps.http,
      sourceId: this.record.id,
      assertAllowed: (url) => {
        this.assertAllowed(url)
      },
      vars: {
        get: (key) => this.deps.vars?.get(key),
        put: (key, value) => void this.deps.vars?.put(key, value),
      },
      ...(this.deps.log ? { log: this.deps.log } : {}),
    })

    for (const [name, fn] of Object.entries(host.functions)) {
      realm.expose(name, fn as (...args: unknown[]) => unknown)
    }
    // The shim first, so a document's own `jsLib` can use `src`.
    await realm.preload(SRC_SHIM)
    if (this.record.doc.jsLib) await realm.preload(this.record.doc.jsLib)

    this.realm = realm
    return realm
  }

  get capabilities(): Capabilities {
    return capabilitiesFor(this.record.doc, {
      ...(this.seekable !== undefined ? { seekable: this.seekable } : {}),
      searchable: this.searchable,
      browsable: this.browsable,
      lyrics: this.lyricable,
    })
  }

  /**
   * The provider handed to `ctx.sources`.
   *
   * Optional members are **absent, not stubbed**: this slice serves the
   * required core and nothing else, which makes it the regression test that
   * every screen checks `capabilities` before reaching for a member.
   */
  /**
   * Whether this document's search rules can actually run in this build.
   *
   * A document may describe a search whose rules need an engine this build
   * does not have — `@css:` without a markup parser, `@js:` without `ctx.js`.
   * Declaring `search: true` then produces a capability the UI offers and the
   * runtime cannot honour, which is exactly the over-declaration deriving
   * capabilities exists to prevent (docs/06 §1.3).
   */
  private get searchable(): boolean {
    const doc = this.record.doc
    if (!doc.searchUrl || !doc.ruleSearch?.trackList) return false
    return rulesRunnable(
      [
        // `header` is rendered on every request this source makes, so a header
        // rule needing a missing engine fails the search just as surely as the
        // search rules would — and was passing the gate, producing exactly the
        // over-declaration §1.3 exists to prevent.
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleSearch).filter((r): r is string => typeof r === 'string'),
      ],
      [doc.searchUrl],
      { js: this.deps.js !== undefined },
    )
  }

  /**
   * Whether this build can actually browse this document.
   *
   * Same two-part test as `searchable`, for the same reason: the document has
   * to describe it, *and* the engines its rules need have to exist here.
   * `exploreUrl` is excluded — a URL template needs no engine.
   */
  private get browsable(): boolean {
    const doc = this.record.doc
    if (!doc.exploreUrl || !doc.ruleExplore?.trackList) return false
    return rulesRunnable(
      [
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleExplore).filter((r): r is string => typeof r === 'string'),
        // `ruleTrackList` is what a descent lands on. A document whose explore
        // rules run but whose track listing cannot is browsable *to a dead
        // end*, which is worse than not offering the button.
        ...Object.values(doc.ruleTrackList ?? {}).filter((r): r is string => typeof r === 'string'),
      ],
      [doc.exploreUrl],
      { js: this.deps.js !== undefined },
    )
  }

  /**
   * Whether an album screen can be served.
   *
   * `ruleAlbum` describes the album's own fields; `ruleTrackList` its songs.
   * Both are needed — an album detail with no tracks is a screen with nothing
   * on it — and both have to be runnable here.
   */
  private get albumable(): boolean {
    const doc = this.record.doc
    if (!doc.ruleAlbum?.title || !doc.ruleTrackList?.trackList) return false
    return rulesRunnable(
      [
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleAlbum).filter((r): r is string => typeof r === 'string'),
        ...Object.values(doc.ruleTrackList).filter((r): r is string => typeof r === 'string'),
      ],
      [],
      { js: this.deps.js !== undefined },
    )
  }

  private get lyricable(): boolean {
    const doc = this.record.doc
    if (!doc.ruleLyric?.lyric) return false
    return rulesRunnable(
      [
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleLyric).filter((r): r is string => typeof r === 'string'),
      ],
      [],
      { js: this.deps.js !== undefined },
    )
  }

  provider(): MediaProvider {
    // `capabilities` is a getter, not a value. Snapshotting it at registration
    // froze `streaming.seekable` at its default of true, so what the HEAD
    // probe learned never reached the UI — an over-declaration of exactly the
    // kind deriving capabilities exists to prevent (docs/11 §4.10).
    const capabilities = () => this.capabilities
    // `MediaProvider & { debug }`: the tracer is a structural extra that
    // `ctx.sources` looks for (docs/06 §10) rather than part of the interface
    // every provider must satisfy — `plugin-source-local` has no rules to
    // trace and should not have to pretend otherwise.
    const provider: MediaProvider & { debug(step: DebugStep): AsyncIterable<TraceEvent> } = {
      sourceId: this.record.id,
      displayName: this.record.name,
      get capabilities() {
        return capabilities()
      },
      auth: this.auth,
      getTrack: (id) => this.getTrack(id),
      resolveStream: (id, prefs) => this.resolveStream(id, prefs),
      ping: () => this.ping(),
      // Absent, not stubbed, when the document does not describe a search or
      // this build cannot run its rules. `ctx.sources` skips a provider whose
      // `search` is missing rather than calling one that throws.
      ...(this.searchable ? { search: (q, page) => this.search(q, page) } : {}),
      ...(this.browsable ? { browse: (nodeId, page) => this.browse(nodeId, page) } : {}),
      ...(this.albumable ? { getAlbum: (id: string) => this.getAlbum(id) } : {}),
      ...(this.lyricable ? { getLyrics: (id: string) => this.getLyrics(id) } : {}),
      // Always present: a source whose rules cannot run is exactly the one a
      // user needs to trace, so gating this on a capability would withdraw the
      // tool at the moment it is wanted.
      debug: (step: DebugStep) => this.debug(step),
    }
    return provider
  }

  async getTrack(id: string): Promise<Track> {
    const payload = await this.payloadFor(id)
    const title = typeof payload?.title === 'string' ? payload.title : lastSegment(this.record.sourceUrl)
    return {
      urn: formatUrn({ sourceId: this.record.id, kind: 'track', id }),
      title,
      artists: [],
      available: true,
    }
  }

  /**
   * Search the backend.
   *
   * Render `searchUrl`, fetch it, run `ruleSearch` over what came back. The
   * page number is 1-based and reaches the template as `{{page}}`; a document
   * that ignores it simply returns the same page, which is why the runtime
   * stops when a page repeats rather than trusting `hasMore`.
   */
  async search(query: SearchQuery, page?: PageRequest): Promise<SearchResult> {
    const doc = this.record.doc
    if (!doc.searchUrl || !doc.ruleSearch) {
      throw new RuleError(
        'this source has no searchUrl or ruleSearch',
        { block: 'ruleSearch', field: 'trackList' },
        this.record.id,
      )
    }

    const pageNumber = pageNumberOf(page)
    const scope: TemplateScope = {
      source: this.sourceScope(),
      key: query.text,
      page: pageNumber,
      baseUrl: this.record.sourceUrl,
    }

    // A URL template, not a selector: it builds the request rather than
    // selecting out of a response, so `=` is optional (docs/06 §2.3).
    const rendered = await this.traced('searchUrl', 'searchUrl', doc.searchUrl, () =>
      evaluateUrlTemplate(
        doc.searchUrl!,
        scope,
        { block: 'searchUrl', field: 'searchUrl', sourceId: this.record.id },
        this.js,
      ),
    )
    const target = parseUrlObject(rendered)
    this.assertAllowed(target.url)

    const fetched = await this.withReauth(() =>
      this.fetchChecked(target, scope, 'searchUrl'),
    )

    const { rows, dropped, incomplete, firstError } = await evaluateListRule(doc.ruleSearch, {
      document: fetched.value,
      scope: { ...scope, baseUrl: fetched.baseUrl },
      sourceId: this.record.id,
      block: 'ruleSearch',
      ...(this.js ? { js: this.js } : {}),
      ...(this.tracing ? { trace: (entry: RuleTraceEntry) => this.tracing?.rule(entry) } : {}),
    })
    if (incomplete > 0) {
      this.deps.log?.(
        `${this.record.id}: ruleSearch left ${incomplete} optional field(s) unset: ${String(firstError)}`,
      )
    }
    if (dropped > 0) {
      // Counted rather than hidden: a search quietly returning three of
      // twenty results reads as a thin backend, not as a broken rule.
      this.deps.log?.(
        `${this.record.id}: ruleSearch dropped ${dropped} result(s) missing trackId or title`,
      )
    }

    const tracks = rows.map((row) => rowToTrack(row, this.record.id, 'ruleSearch'))

    /*
     * The payload is what makes `ruleStream` work hours later and offline from
     * the search that produced the track (docs/06 §4). `ctx.sources` writes it
     * to `tracks.raw_json`; `scopeFor` reads it back as `{{track.*}}`.
     *
     * Without it, resolution can only see the URN's id — so a document whose
     * stream URL needs anything else (`{{track.quality}}` from `$.suffix`, a
     * per-item token, a CDN path) worked during the search that fetched it and
     * failed after a restart, which is the hardest kind of bug to attribute.
     */
    const payloads: Record<string, unknown> = {}
    for (const [i, row] of rows.entries()) {
      const track = tracks[i]
      if (track) payloads[track.urn] = payloadFor(row)
    }

    return {
      tracks: {
        items: tracks,
        // The backend rarely says, and inventing a total produces a progress
        // bar that lies (docs/06 §4.3).
        hasMore: tracks.length > 0,
        ...(tracks.length > 0 ? { cursor: String(pageNumber + 1) } : {}),
      },
      payloads,
    }
  }

  /** Headers the document declares, rendered against the current scope. */
  private async headers(scope: TemplateScope): Promise<Record<string, string> | undefined> {
    const rule = this.record.doc.header
    if (!rule) return undefined
    const rendered = await evaluateRule(rule, scope, {
      block: 'header',
      field: 'header',
      sourceId: this.record.id,
    }, this.js)
    try {
      const parsed: unknown = JSON.parse(rendered)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v
      return Object.keys(out).length > 0 ? out : undefined
    } catch {
      throw new RuleError(
        'header must render to a JSON object',
        { block: 'header', field: 'header' },
        this.record.id,
      )
    }
  }

  /**
   * Walk the source's own hierarchy.
   *
   * Three stages, and which one applies is carried by the node id rather than
   * inferred:
   *
   *   (no node)  `exploreUrl`  → the source's top-level sections
   *   'explore'  `ruleExplore` → what a section contains, usually albums
   *   'tracks'   `ruleTrackList` → the tracks inside one of those
   *
   * docs/06 §4 draws this as one pipeline because it is: fetch a document,
   * run a list rule over it, and decide per row whether it is a leaf or
   * another node. Only the rule changes between stages.
   */
  async browse(nodeId?: string, page?: PageRequest): Promise<BrowseResult> {
    const doc = this.record.doc
    if (!doc.exploreUrl || !doc.ruleExplore) {
      throw new RuleError(
        'this source has no exploreUrl or ruleExplore',
        { block: 'ruleExplore', field: 'trackList' },
        this.record.id,
      )
    }

    const pageNumber = pageNumberOf(page)
    const scope: TemplateScope = {
      source: this.sourceScope(),
      page: pageNumber,
      baseUrl: this.record.sourceUrl,
    }

    const node = nodeId
      ? decodeNode(nodeId, this.record.id)
      : await this.rootNode(doc.exploreUrl, scope)
    // The root may resolve to a list of sections rather than to a URL, in
    // which case there is nothing to fetch and the sections *are* the answer.
    if (Array.isArray(node)) return { items: node, hasMore: false }

    const rule = node.stage === 'tracks' ? (doc.ruleTrackList ?? doc.ruleExplore) : doc.ruleExplore
    const block = node.stage === 'tracks' ? 'ruleTrackList' : 'ruleExplore'

    const target = parseUrlObject(node.url)
    this.assertAllowed(target.url)
    const fetched = await this.withReauth(() => this.fetchChecked(target, scope, block))

    const { rows, dropped, incomplete, firstError } = await evaluateListRule(rule, {
      document: fetched.value,
      scope: { ...scope, baseUrl: fetched.baseUrl },
      sourceId: this.record.id,
      block,
    })
    if (dropped > 0) {
      this.deps.log?.(
        `${this.record.id}: ${block} dropped ${dropped} row(s) missing trackId or title`,
      )
    }
    if (incomplete > 0) {
      this.deps.log?.(
        `${this.record.id}: ${block} left ${incomplete} optional field(s) unset: ${String(firstError)}`,
      )
    }

    const items = rows.map((row) => this.rowToEntry(row, node.stage))

    /*
     * Payloads for the leaves only.
     *
     * A leaf is a track, and a track has to still resolve after a restart by
     * the same route a searched one does (docs/06 §4). A node is a place, not
     * a thing — nothing caches it and nothing plays it.
     */
    const payloads: Record<string, unknown> = {}
    for (const [i, row] of rows.entries()) {
      const entry = items[i]
      if (!entry?.urn) continue
      /*
       * A node's payload keeps its `childUrl` alongside the backend's own
       * fields. That is what `getAlbum` reads back: the URL of the album's
       * document, which nothing else in the app knows and which cannot be
       * derived from an id.
       */
      payloads[entry.urn] = payloadFor(row)
    }

    return {
      items,
      hasMore: items.length > 0,
      ...(items.length > 0 ? { cursor: String(pageNumber + 1) } : {}),
      payloads,
    }
  }

  /**
   * The top of the tree: either a list of sections, or one URL to run explore on.
   *
   * docs/06 §2.1 calls `exploreUrl` "a JSON array of { title, url }, or a
   * rule". Both readings are useful and they are told apart by what the render
   * produces, not by a flag: a source with one browsable list writes the URL,
   * and one with several writes the array.
   */
  private async rootNode(
    exploreUrl: string,
    scope: TemplateScope,
  ): Promise<BrowseEntry[] | BrowseNode> {
    const rendered = await this.traced('exploreUrl', 'exploreUrl', exploreUrl, () =>
      evaluateUrlTemplate(
        exploreUrl,
        scope,
        { block: 'exploreUrl', field: 'exploreUrl', sourceId: this.record.id },
        this.js,
      ),
    )

    const sections = parseSections(rendered)
    if (!sections) return { stage: 'explore', url: rendered }

    return sections.map((section) => ({
      id: encodeNode({ stage: 'explore', url: section.url }, this.record.id),
      title: section.title,
      kind: 'folder' as const,
      leaf: false,
    }))
  }

  /**
   * One list row as a browse entry.
   *
   * `childUrl` decides leaf from node, exactly as docs/06 §2.2 says: an item
   * carrying one is somewhere to go, an item without one is something to play.
   * `kind` is the document's own label where it gave a valid one — it drives
   * the icon and nothing else, so an unrecognised value falls back rather than
   * failing the browse.
   */
  private rowToEntry(row: Record<string, unknown>, stage: BrowseStage): BrowseEntry {
    const child = typeof row.childUrl === 'string' ? row.childUrl.trim() : ''
    const declared = typeof row.kind === 'string' ? row.kind.trim() : ''
    const kind = (BROWSE_KINDS as readonly string[]).includes(declared)
      ? (declared as BrowseEntry['kind'])
      : child
        ? 'folder'
        : 'track'

    const entry: BrowseEntry = {
      // A node's id carries where to go next; a leaf's is the backend's own
      // id, which is what `resolveStream` will be handed.
      id: child
        ? encodeNode({ stage: nextStage(stage), url: child }, this.record.id)
        : String(row.trackId),
      title: String(row.title),
      kind,
      leaf: !child,
    }
    const artist = typeof row.artist === 'string' ? row.artist : undefined
    if (artist) entry.subtitle = artist
    if (typeof row.artwork === 'string') entry.artwork = { id: row.artwork, sourceUrl: row.artwork }

    /*
     * Identity, where the row has one — for nodes too.
     *
     * An album in an explore listing is both somewhere to go *and* something
     * with an identity worth caching, and treating "no urn" as "descend" meant
     * albums were never cached. `getAlbum` then had no document URL to fetch,
     * so the `childUrl → ruleAlbum → ruleTrackList` half of the pipeline had
     * nowhere to start.
     */
    const id = typeof row.trackId === 'string' ? row.trackId : undefined
    if (id) {
      entry.urn = formatUrn({
        sourceId: this.record.id,
        kind: kind === 'album' ? 'album' : kind === 'artist' ? 'artist' : 'track',
        id,
      })
    }
    return entry
  }


  /**
   * Run one step with every intermediate value on show.
   *
   * The direct equivalent of legado's source-debug screen, and the thing that
   * makes a rotted source repairable in seconds instead of by re-import. Three
   * properties do the work (docs/06 §10):
   *
   *  - **Every step appears, including the ones that worked.** The failure is
   *    usually two steps before the empty result, and a trace of failures only
   *    hides it.
   *  - **It streams.** A request to a server that has stopped answering shows
   *    as an `http` line with no status and nothing after it — which is the
   *    diagnosis. Collecting first would show nothing until it gave up.
   *  - **It redacts.** A trace is what gets pasted into a forum thread, and a
   *    Subsonic URL carries a password hash and its salt as a matter of course.
   */
  debug(step: DebugStep): AsyncIterable<TraceEvent> {
    const collector = new TraceCollector(this.secrets())

    // Started, not awaited: the caller iterates while this runs, which is the
    // point. Everything it can throw is reported into the trace instead.
    void this.runTraced(step, collector)
    return collector
  }

  private async runTraced(step: DebugStep, collector: TraceCollector): Promise<void> {
    // ⚠️ One step at a time. Two concurrent traces would interleave into one
    // stream and each would look like the other's rules had failed.
    if (this.tracing) {
      collector.error(new Error('a trace is already running for this source'))
      collector.close()
      return
    }
    this.tracing = collector
    try {
      switch (step.kind) {
        case 'search': {
          const result = await this.search({ text: step.text }, pageOf(step.page))
          const items = result.tracks?.items ?? []
          collector.result(
            items.length > 0
              ? `${items.length} track(s); first: ${items[0]!.title}`
              : 'the rules ran and matched nothing',
          )
          break
        }
        case 'explore': {
          const page = await this.browse(step.url, pageOf(step.page))
          collector.result(
            page.items.length > 0
              ? `${page.items.length} entr(ies); first: ${page.items[0]!.title}`
              : 'the rules ran and matched nothing',
          )
          break
        }
        case 'album': {
          const page = await this.browse(step.url)
          collector.result(`${page.items.length} entr(ies)`)
          break
        }
        case 'stream': {
          const id = step.urn.includes(':') ? (step.urn.split(':').pop() ?? step.urn) : step.urn
          const handle = await this.resolveStream(id, DEBUG_PREFS)
          collector.result(
            handle.kind === 'remote'
              ? `resolved to ${handle.seekable ? 'a seekable' : 'a non-seekable'} stream`
              : 'resolved to a local file',
          )
          break
        }
      }
    } catch (error) {
      collector.error(
        error,
        error instanceof RuleError ? error.rule : undefined,
      )
    } finally {
      this.tracing = undefined
      collector.close()
    }
  }

  /**
   * `{{source.*}}` — url, name, and the per-source variable.
   *
   * `var` is documented scope (docs/06 §3.2) and is how a Subsonic document
   * reaches the credentials the user typed. It was missing, so every document
   * written to the published example failed on its first request with
   * "{{source.var}} resolved to nothing" — and the fix looked like a rule bug
   * rather than a missing binding.
   */
  private sourceScope(): { url: string; name: string; var?: string } {
    const variable = this.deps.vars?.get('var')
    return {
      url: this.record.sourceUrl,
      name: this.record.name,
      ...(variable === undefined ? {} : { var: variable }),
    }
  }

  /**
   * Time a template field and report it, when a trace is running.
   *
   * `searchUrl`, `ruleStream.url` and the rest are single-atom templates
   * evaluated through `template.ts` rather than through the atom pipeline, so
   * the engine's own trace hook never sees them — and they are exactly the
   * lines a user needs, because a wrong URL is the most common way a source
   * rots.
   */
  private async traced<T>(
    block: string,
    field: string,
    rule: string,
    run: () => Promise<T>,
  ): Promise<T> {
    if (!this.tracing) return run()
    const collector = this.tracing
    const started = Date.now()
    try {
      const out = await run()
      collector.rule({
        block,
        field,
        engine: 'template',
        rule,
        input: '',
        output: out,
        ms: Date.now() - started,
      })
      return out
    } catch (error) {
      collector.rule({
        block,
        field,
        engine: 'template',
        rule,
        input: '',
        output: `✗ ${String(error)}`,
        ms: Date.now() - started,
      })
      throw error
    }
  }

  /**
   * Values that must never appear in a trace, whatever they look like.
   *
   * The source variable and everything a script stored. Redaction by *shape*
   * catches `t=` and `password=`; this catches the password itself, wherever
   * a document decided to put it.
   */
  private secrets(): string[] {
    const out: string[] = []
    const variable = this.deps.vars?.get('var')
    if (variable) {
      out.push(variable)
      // A `user:password` variable is usually split before use, so the halves
      // are what actually reach a URL — the whole string never appears.
      for (const part of variable.split(':')) if (part.length >= 3) out.push(part)
    }
    return out
  }

  /**
   * Perform the document's `loginUrl` request.
   *
   * The stored fields are in scope as `{{login.*}}`, so a document writes its
   * own body — form-encoded, JSON, whatever the backend wants — rather than
   * the runtime guessing at a shape. Whatever session the response sets lands
   * in the source's cookie jar on the way past, which is the entire mechanism
   * for most self-hosted backends.
   */
  private async login(): Promise<void> {
    const url = this.record.doc.loginUrl
    if (!url) throw new AuthError('this source declares a login form but no loginUrl')

    const login: Record<string, unknown> = {}
    for (const field of this.record.doc.loginUi ?? []) {
      const value = this.deps.vars?.get(field.id)
      if (value !== undefined) login[field.id] = value
    }

    const scope: TemplateScope = {
      source: this.sourceScope(),
      baseUrl: this.record.sourceUrl,
      ...({ login } as Partial<TemplateScope>),
    }
    const rendered = await evaluateUrlTemplate(
      url,
      scope,
      { block: 'loginUrl', field: 'loginUrl', sourceId: this.record.id },
      this.js,
    )
    const target = parseUrlObject(rendered)
    this.assertAllowed(target.url)

    try {
      await fetchDocument(this.http, target, await this.headers(scope), {
        sourceId: this.record.id,
        block: 'loginUrl',
      })
    } catch (error) {
      /*
       * A refused login is an `AuthError` whatever the backend called it. A
       * 403 arriving as a `CapabilityError` or a 500 as a `ProviderError`
       * would each send the retry logic somewhere unhelpful — the caller's
       * question is only ever "did the credentials work?".
       */
      if (error instanceof AuthError) throw error
      throw new AuthError(
        `login failed for ${this.record.id}: ${String(error)}`,
        this.record.id,
        { cause: error },
      )
    }
  }

  /**
   * Run a request, and re-authenticate once if the session turned out to be over.
   *
   * ⚠️ Once. A retry loop against a backend that answers 401 to everything is
   * a login storm, and the second failure is information — it means the stored
   * credentials are wrong, not stale, which needs the user rather than another
   * attempt.
   */
  private async withReauth<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (!(error instanceof AuthError) || this.auth.flow.kind !== 'form') {
        // Nothing to re-run for a `variable` source: its credentials are
        // static, so an expired session there needs the user.
        if (error instanceof AuthError) this.auth.markExpired()
        throw error
      }
      try {
        await this.auth.refresh()
      } catch {
        this.auth.markExpired()
        throw error
      }
      try {
        return await run()
      } catch (again) {
        if (again instanceof AuthError) this.auth.markExpired()
        throw again
      }
    }
  }

  /**
   * One album: its own fields, and the tracks on it.
   *
   * The last leg of docs/06 §4's pipeline — `childUrl` → `ruleAlbum` →
   * `ruleTrackList`. The album's document URL comes from the payload a browse
   * stored, because it is a URL the *backend* chose and nothing about an id
   * implies it.
   */
  async getAlbum(id: string): Promise<AlbumDetail> {
    const doc = this.record.doc
    const site = { block: 'ruleAlbum', field: 'title' }
    if (!doc.ruleAlbum || !doc.ruleTrackList) {
      throw new RuleError('this source has no ruleAlbum or ruleTrackList', site, this.record.id)
    }

    const payload = (await this.deps.albumPayload?.(id)) ?? {}
    const url = typeof payload.childUrl === 'string' ? payload.childUrl : undefined
    if (!url) {
      /*
       * Not "no such album": the album may be perfectly real and simply never
       * browsed to on this device. Saying which of the two it is saves the
       * user looking for a backend problem that is not there.
       */
      throw new RuleError(
        `no stored document url for album ${id} — browse to it once, so its childUrl is cached`,
        site,
        this.record.id,
      )
    }

    const scope: TemplateScope = {
      source: this.sourceScope(),
      album: { id, ...payload },
      baseUrl: this.record.sourceUrl,
    }

    const target = parseUrlObject(url)
    this.assertAllowed(target.url)
    const fetched = await this.withReauth(() => this.fetchChecked(target, scope, 'ruleAlbum'))

    const albumScope: TemplateScope = { ...scope, baseUrl: fetched.baseUrl }
    const field = async (name: string, rule: string | undefined): Promise<string | undefined> => {
      if (!rule) return undefined
      const values = await evaluate(rule, {
        document: fetched.value,
        scope: albumScope,
        site: { block: 'ruleAlbum', field: name, sourceId: this.record.id },
        vars: new Map(),
        ...(this.js ? { js: this.js } : {}),
        ...(this.tracing ? { trace: (e: RuleTraceEntry) => this.tracing?.rule(e) } : {}),
      })
      return values[0]
    }

    /*
     * `trackListUrl` means the songs live in a *different* document from the
     * album's own fields — common on backends that page a long tracklist. When
     * it is absent the same document holds both, which is the Subsonic shape.
     */
    const listUrl = await field('trackListUrl', doc.ruleAlbum.trackListUrl)
    let listDocument: unknown = fetched.value
    let listBase = fetched.baseUrl
    if (listUrl) {
      const listTarget = parseUrlObject(listUrl)
      this.assertAllowed(listTarget.url)
      const listFetched = await fetchDocument(this.http, listTarget, await this.headers(scope), {
        sourceId: this.record.id,
        block: 'ruleTrackList',
      })
      listDocument = listFetched.value
      listBase = listFetched.baseUrl
    }

    const { rows, dropped, incomplete, firstError } = await evaluateListRule(doc.ruleTrackList, {
      document: listDocument,
      scope: { ...albumScope, baseUrl: listBase },
      sourceId: this.record.id,
      block: 'ruleTrackList',
      ...(this.js ? { js: this.js } : {}),
      ...(this.tracing ? { trace: (e: RuleTraceEntry) => this.tracing?.rule(e) } : {}),
    })
    if (dropped > 0 || incomplete > 0) {
      this.deps.log?.(
        `${this.record.id}: ruleTrackList dropped ${dropped} row(s), left ${incomplete} field(s) unset` +
          (firstError ? `: ${String(firstError)}` : ''),
      )
    }

    const albumUrn = formatUrn({ sourceId: this.record.id, kind: 'album', id })
    const tracks = rows.map((row) => {
      const track = rowToTrack(row, this.record.id, 'ruleTrackList')
      // The listing rarely repeats the album it is a listing *of*.
      track.albumUrn ??= albumUrn
      return track
    })

    const payloads: Record<string, unknown> = {}
    for (const [i, row] of rows.entries()) {
      const track = tracks[i]
      if (track) payloads[track.urn] = payloadFor(row)
    }

    const artist = await field('artist', doc.ruleAlbum.artist)
    const year = numberOr(await field('year', doc.ruleAlbum.year))
    const trackCount = numberOr(await field('trackCount', doc.ruleAlbum.trackCount))
    const artwork = await field('artwork', doc.ruleAlbum.artwork)

    return {
      urn: albumUrn,
      title: (await field('title', doc.ruleAlbum.title)) ?? String(payload.title ?? id),
      artists: artist
        ? [
            {
              urn: formatUrn({ sourceId: this.record.id, kind: 'artist', id: slugOf(artist) }),
              name: artist,
              role: 'main',
              ordinal: 0,
            },
          ]
        : [],
      ...(year !== undefined ? { year } : {}),
      ...(trackCount !== undefined ? { trackCount } : {}),
      ...(artwork ? { artwork: { id: artwork, sourceUrl: artwork } } : {}),
      tracks,
      payloads,
    }
  }

  /**
   * Lyrics for one track.
   *
   * Evaluated against the track's stored payload rather than a fresh fetch
   * where the document allows it: `ruleLyric.lyric` is often a template over
   * `{{track.*}}` that names a `.lrc` beside the audio, and refetching a
   * search to find that would be absurd.
   */
  async getLyrics(id: string): Promise<Lyrics | undefined> {
    const rules = this.record.doc.ruleLyric
    if (!rules) return undefined

    const payload = (await this.deps.trackPayload?.(id)) ?? {}
    const scope: TemplateScope = {
      source: this.sourceScope(),
      track: { ...payload, id },
      baseUrl: this.record.sourceUrl,
    }

    /*
     * Two shapes, told apart by what the rule produces. A rule yielding a URL
     * means "fetch this and the body is the lyrics"; anything else *is* the
     * lyrics. Documents write both, and requiring a flag to say which would be
     * a field every author forgets.
     */
    const produced = await this.traced('ruleLyric', 'lyric', rules.lyric, () =>
      evaluateRule(
        rules.lyric,
        scope,
        { block: 'ruleLyric', field: 'lyric', sourceId: this.record.id },
        this.js,
      ),
    ).catch(() => undefined)
    if (!produced) return undefined

    let content = produced
    if (/^https?:\/\//i.test(produced.trim())) {
      const target = parseUrlObject(produced.trim())
      this.assertAllowed(target.url)
      const fetched = await fetchDocument(this.http, target, await this.headers(scope), {
        sourceId: this.record.id,
        block: 'ruleLyric',
      })
      content = fetched.text
    }
    if (!content.trim()) return undefined

    const declared = rules.format
      ? await this.renderOptionalIn('ruleLyric', 'format', rules.format, scope)
      : undefined
    const offsetMs = numberOr(
      rules.offsetMs
        ? await this.renderOptionalIn('ruleLyric', 'offsetMs', rules.offsetMs, scope)
        : undefined,
    )

    // Sniffed when the document does not say: `[mm:ss.xx]` is what makes a
    // lyric sheet scroll rather than sit there, and it is unambiguous.
    const format: LyricsFormat =
      declared === 'lrc' || declared === 'ttml' || declared === 'plain'
        ? declared
        : /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(content)
          ? 'lrc'
          : 'plain'

    return {
      format,
      content,
      synced: format === 'lrc' || format === 'ttml',
      ...(offsetMs !== undefined ? { offsetMs } : {}),
    }
  }

  /** `renderOptional`, for a block other than `ruleStream`. */
  private async renderOptionalIn(
    block: string,
    field: string,
    rule: string,
    scope: TemplateScope,
  ): Promise<string | undefined> {
    return evaluateRule(rule, scope, { block, field, sourceId: this.record.id }, this.js)
  }

  /**
   * The moment a URN becomes bytes.
   *
   * Everything in scope here is either the document's own (`source`), stored
   * with the track (`track`), or the caller's (`prefs`). A rule that reaches
   * for anything else fails with a `RuleError` naming itself, which is what
   * makes the difference between "this source needs updating" and "something
   * went wrong".
   */
  async resolveStream(id: string, prefs: StreamPrefs): Promise<StreamHandle> {
    const rules = this.record.doc.ruleStream
    if (!rules) {
      throw new RuleError(
        `source ${this.record.id} has no ruleStream`,
        { block: 'ruleStream', field: 'url' },
        this.record.id,
      )
    }

    const scope = await this.scopeFor(id, prefs)
    const target = await this.traced('ruleStream', 'url', rules.url, () =>
      evaluateRule(
        rules.url,
        scope,
        { block: 'ruleStream', field: 'url', sourceId: this.record.id },
        this.js,
      ),
    )

    // The one artifact that leaves this package and is fetched by something
    // else: `ctx.audio` loads it directly, outside the source's scoped http.
    // Without this check the egress allowlist would govern one optional HEAD
    // and nothing that actually moves bytes — nominal, not real.
    this.assertAllowed(target)

    const declaredSeekable = rules.seekable
      ? (await this.renderOptional('seekable', rules.seekable, scope)) !== 'false'
      : undefined
    const probe = declaredSeekable === undefined ? await this.probe(target) : undefined

    const mimeType = (await this.renderOptional('mimeType', rules.mimeType, scope)) ?? probe?.mimeType
    const byteLength =
      numberOr(await this.renderOptional('byteLength', rules.byteLength, scope)) ?? probe?.byteLength
    const expiresAt = numberOr(await this.renderOptional('expiresAt', rules.expiresAt, scope))
    const bitrateKbps = numberOr(await this.renderOptional('bitrateKbps', rules.bitrateKbps, scope))
    const headers = parseHeaders(await this.renderOptional('headers', rules.headers, scope))

    this.seekable = declaredSeekable ?? probe?.seekable ?? this.seekable ?? true

    return {
      kind: 'remote',
      target,
      seekable: this.seekable,
      ...(mimeType ? { mimeType } : {}),
      ...(byteLength ? { byteLength } : {}),
      ...(bitrateKbps ? { bitrateKbps } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(headers ? { headers } : {}),
    }
  }

  /**
   * Cheap by contract: one HEAD against the base URL, and no rules run.
   *
   * "Reachable" is the question, not "healthy". A server that refuses HEAD or
   * demands credentials is reachable — reporting it unreachable would make the
   * source list say the network is down when the network is fine.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await this.deps.http({
        url: this.record.sourceUrl,
        method: 'HEAD',
        timeoutMs: 5000,
      })
      if (res.status === 405 || res.status === 501) return true
      if (res.status === 401 || res.status === 403) return true
      return res.status < 500
    } catch {
      return false
    }
  }

  private async scopeFor(id: string, prefs: StreamPrefs): Promise<TemplateScope> {
    const payload = await this.payloadFor(id)
    return {
      source: this.sourceScope(),
      // `id` last, so a stored payload carrying its own `id` cannot displace
      // the one the caller asked to resolve — that would resolve a stream for
      // a different track and look like a backend bug.
      track: { ...(payload ?? {}), id },
      prefs: { ...prefs },
      baseUrl: this.record.sourceUrl,
    }
  }

  private async payloadFor(id: string): Promise<Record<string, unknown> | undefined> {
    if (!this.deps.trackPayload) return undefined
    return this.deps.trackPayload(id)
  }

  /** Optional rules resolve to `undefined` when absent, and throw when broken. */
  private async renderOptional(
    field: string,
    rule: string | undefined,
    scope: TemplateScope,
  ): Promise<string | undefined> {
    if (!rule) return undefined
    return evaluateRule(rule, scope, {
      block: 'ruleStream',
      field,
      sourceId: this.record.id,
    }, this.js)
  }

  /** Refuse a URL to a host this source did not declare. */
  private assertAllowed(target: string): void {
    let host: string
    try {
      // `hostname` keeps IPv6 brackets and may carry a trailing FQDN dot;
      // `declaredHostMatches` normalises both, so `example.org.` cannot get
      // one verdict here and another at the HTTP gate.
      host = new URL(target).hostname
    } catch {
      throw new ProviderError(`ruleStream.url produced a malformed URL`, this.record.id)
    }
    if (!hostAllowedBy(host, this.record.allowedHosts)) {
      throw new UnavailableError(
        `${this.record.id} did not declare ${host}; add it to allowedHosts and re-import`,
        this.record.id,
      )
    }
  }

  /**
   * Ask the server what it will serve.
   *
   * ⚠️ A status code is not a diagnosis, and collapsing them all into
   * `NotFoundError` made three separate lies: a HEAD-refusing server (405/501,
   * which the code itself called common) was reported as a dead URL; an
   * expired session (401/403) skipped the re-login path; and a transient 500
   * became non-retryable, so a blip halted playback and a health check killed
   * a live source.
   */
  private get http(): HttpService {
    return this.tracing ? tracedHttp(this.deps.http, this.tracing) : this.deps.http
  }

  /**
   * Fetch, then ask the document whether the session is still good.
   *
   * `loginCheckJs` exists because no HTTP status reliably signals "the server
   * started answering with the login page again" — plenty of backends serve
   * that with a 200 (docs/06 §5). The document is the only thing that knows,
   * so it is asked, and a `false` becomes an `AuthError` the retry path
   * already understands.
   */
  private async fetchChecked(
    target: ReturnType<typeof parseUrlObject>,
    scope: TemplateScope,
    block: string,
  ): Promise<Awaited<ReturnType<typeof fetchDocument>>> {
    const fetched = await fetchDocument(this.http, target, await this.headers(scope), {
      sourceId: this.record.id,
      block,
    })

    const check = this.record.doc.loginCheckJs
    if (check && this.js) {
      const ok = await this.js(check, { ...scope, result: fetched.value } as TemplateScope)
      if (ok === false) {
        throw new AuthError(`the session for ${this.record.id} is no longer valid`, this.record.id)
      }
    }
    return fetched
  }

  private async probe(
    url: string,
  ): Promise<{ seekable: boolean; byteLength?: number; mimeType?: string } | undefined> {
    let head
    try {
      head = await this.deps.http({ url, method: 'HEAD' })
    } catch (error) {
      // Transport failure. Not fatal: plenty of servers dislike HEAD, and the
      // player's own error path handles a target that turns out to be dead.
      if (error instanceof NetworkError) return undefined
      throw error
    }

    if (head.status < 400) {
      const length = Number(head.headers['content-length'] ?? '')
      const mimeType = head.headers['content-type']
      return {
        seekable: (head.headers['accept-ranges'] ?? '').includes('bytes'),
        ...(Number.isFinite(length) && length > 0 ? { byteLength: length } : {}),
        ...(mimeType ? { mimeType } : {}),
      }
    }

    // The server answered, and what it said matters.
    if (head.status === 405 || head.status === 501) return undefined // no HEAD; assume playable
    if (head.status === 404 || head.status === 410) {
      throw new NotFoundError(`${head.status} for ${url}`, this.record.id)
    }
    if (head.status === 401 || head.status === 403) {
      throw new AuthError(`${head.status} for ${url}`, this.record.id)
    }
    if (head.status === 429) {
      throw new RateLimitError(`rate limited by ${new URL(url).hostname}`, 60_000, this.record.id)
    }
    if (head.status >= 500) {
      throw new NetworkError(`${head.status} from ${url}`, this.record.id)
    }
    throw new ProviderError(`${head.status} for ${url}`, this.record.id)
  }
}

/** A page cursor is an opaque string that happens to be a number here. */
function pageNumberOf(page: PageRequest | undefined): number {
  const parsed = Number(page?.cursor ?? '1')
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1
}

/** Whether every rule in a set uses only engines this build can run. */
/**
 * Whether every engine these rules reach exists in this build.
 *
 * `rules` are selectors and are parsed. `urlTemplates` are **not**: a URL
 * template is interpolated, not selected with, so parsing `{{source.url}}/x`
 * as a rule infers a CSS selector and declares the whole document unrunnable
 * — which is precisely what happened to the shipped Subsonic fixture the first
 * time `searchUrl` was added to this check.
 *
 * They are still checked, for one thing: `{{@js:…}}`. A document whose auth
 * lives in its URL is unsearchable without a sandbox however good its rules
 * are, and reporting otherwise is the over-declaration deriving capabilities
 * exists to prevent.
 */
function rulesRunnable(
  rules: readonly (string | undefined)[],
  urlTemplates: readonly (string | undefined)[],
  opts: { js: boolean },
): boolean {
  if (!opts.js && [...rules, ...urlTemplates].some((r) => r && TEMPLATE_JS.test(r))) return false

  return rules.every((rule) => {
    if (!rule) return true
    try {
      return parseRule(rule).alternatives.every((alt) =>
        alt.parts.every((part) =>
          part.atoms.every((atom) => engineAvailable(atom.engine, { js: opts.js })),
        ),
      )
    } catch {
      // A rule this build cannot even parse is not runnable. Refusing the
      // capability is right; the author sees the syntax error when they run it.
      return false
    }
  })
}

/** `{{@js:…}}` — a script inside a template placeholder. */
const TEMPLATE_JS = /\{\{\s*@js:/

function numberOr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function parseHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v
    }
    return Object.keys(out).length ? out : undefined
  } catch {
    return undefined
  }
}

function lastSegment(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? url)
  } catch {
    return url
  }
}

/**
 * What gets stored as a track's `raw_json`.
 *
 * The backend's own element *plus* the fields the document's rules produced,
 * with the rules winning. Both are needed and neither is enough:
 *
 *  - The raw element is what `{{track.id}}` means for a Subsonic song, and it
 *    carries fields no rule bothered to name.
 *  - The evaluated fields are what the author actually asked for — `quality`
 *    from `$.suffix`, a `streamUrl` assembled from three parts — and several
 *    of them have nowhere else to go: `rowToTrack` maps only the members
 *    `Track` has, so `quality` would otherwise be computed and discarded.
 *
 * Rules win a collision because they are the author's stated intent about that
 * name; the raw element merely happened to use it.
 */
function payloadFor(row: Record<string, unknown>): Record<string, unknown> {
  const { raw, ...evaluated } = row
  const base =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  return { ...base, ...evaluated }
}

/* ── browse nodes ─────────────────────────────────────────────────────── */

/** Which rule a node's document should be read with. */
type BrowseStage = 'explore' | 'tracks'

interface BrowseNode {
  stage: BrowseStage
  url: string
}

/** Descending from a section lands on tracks. There is no deeper stage. */
function nextStage(from: BrowseStage): BrowseStage {
  return from === 'explore' ? 'tracks' : 'tracks'
}

const BROWSE_KINDS = ['folder', 'album', 'artist', 'playlist', 'track', 'genre'] as const

/**
 * A node id: the stage and the URL to fetch, encoded together.
 *
 * Self-contained rather than a key into a map the runtime keeps, because a
 * shell restores its navigation stack after a restart and a map would not
 * have survived it — the user would come back to a folder that no longer
 * exists and be shown an error for having been away.
 *
 * The source id is included and checked on the way back in. It is not a
 * security boundary — the egress allowlist is, and `browse` re-checks it on
 * every fetch — but it turns "this id came from another source" from a
 * confusing cross-source fetch into a plain refusal.
 */
function encodeNode(node: BrowseNode, sourceId: string): string {
  const json = JSON.stringify({ v: 1, s: sourceId, t: node.stage, u: node.url })
  return `n1.${Buffer.from(json, 'utf8').toString('base64url')}`
}

function decodeNode(nodeId: string, sourceId: string): BrowseNode {
  const bad = (reason: string): never => {
    throw new RuleError(
      `cannot browse to ${JSON.stringify(nodeId)}: ${reason}`,
      { block: 'ruleExplore', field: 'childUrl' },
      sourceId,
    )
  }
  if (!nodeId.startsWith('n1.')) {
    // A shell passing a leaf's id back to `browse` is the likely cause, and
    // saying so beats "invalid base64".
    return bad('that is a leaf id, not a folder — leaves are played, not opened')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(nodeId.slice(3), 'base64url').toString('utf8'))
  } catch {
    return bad('it is not a node id this runtime produced')
  }
  if (!parsed || typeof parsed !== 'object') return bad('it is not a node id this runtime produced')

  const { s, t, u } = parsed as Record<string, unknown>
  if (s !== sourceId) return bad('it belongs to a different source')
  if (t !== 'explore' && t !== 'tracks') return bad('it names no stage this runtime knows')
  if (typeof u !== 'string' || !u) return bad('it carries no URL')
  return { stage: t, url: u }
}

/**
 * `[{"title":…,"url":…}]` → sections, or `undefined` when it is just a URL.
 *
 * Strict about the shape and silent about the failure: anything that is not an
 * array of titled URLs is a URL, which is the other documented spelling. An
 * array that *is* present but malformed is the one case worth refusing, since
 * a source that meant sections and typed them wrong would otherwise be told
 * its URL was unreachable.
 */
function parseSections(rendered: string): { title: string; url: string }[] | undefined {
  const text = rendered.trim()
  if (!text.startsWith('[')) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined

  const sections: { title: string; url: string }[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const { title, url } = entry as Record<string, unknown>
    if (typeof title !== 'string' || typeof url !== 'string' || !url.trim()) continue
    sections.push({ title, url: url.trim() })
  }
  return sections
}


/**
 * The body of a `@js:` expression, as a function body.
 *
 * Every real document writes an expression — `auth()`, `result.map(s => s.id)`
 * — but authors also write several statements ending in a `return`. Accepting
 * both means adding an implicit `return` only where there is not one already;
 * adding it unconditionally would turn `return x` into `return return x`.
 */
function bodyOf(expression: string): string {
  const trimmed = expression.trim()
  if (/\breturn\b/.test(trimmed) || /[;\n]/.test(trimmed)) return trimmed
  return `return (${trimmed})`
}


/**
 * `src.vars` as the runtime needs it.
 *
 * `get` is synchronous because a script reads it from inside a `{{ }}`
 * placeholder, where there is nowhere to await. `load` is the one async part,
 * and it is called once while the realm is being built — the first moment a
 * script could reach any of this.
 */
export interface SourceVars {
  load?(): Promise<void>
  get(key: string): string | undefined
  put(key: string, value: string): void
}


/**
 * Prefs for a traced stream resolution.
 *
 * Fixed rather than the user's: a trace is a diagnosis, and it should ask for
 * the same thing every time so two traces of the same source are comparable.
 */
const DEBUG_PREFS: StreamPrefs = { quality: 'normal', saveData: false, acceptFormats: [] }

/** A 1-based page number as the cursor a provider actually takes. */
function pageOf(page: number | undefined): PageRequest | undefined {
  return page === undefined ? undefined : { cursor: String(page) }
}


/** What `DocumentAuth` needs of the world. See `SourceDeps.signOut`. */
interface SessionStore {
  get(key: string): string | undefined
  put(key: string, value: string): Promise<void>
  clear(): Promise<void>
  /** Perform the document's `loginUrl` request. Throws `AuthError` on refusal. */
  login(): Promise<void>
}


/** A name as a URN segment. The same slug the catalogue writer uses. */
function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
}
