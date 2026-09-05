# Source documents

Example source strings — the thing a user imports (docs/06). They live here
rather than in `packages/` because **a music backend is not a package**: these
are data, and the only code that reads them is `plugin-source-runtime`.

Two uses:

- **Worked examples.** The shortest honest answer to "what does a source
  actually look like".
- **The corpus.** Replayed end to end against recorded HTTP fixtures, so a
  change to the rule engine that breaks a real document fails CI
  (docs/09 §6).

## What is expressible today

- **`=` templates** with `{{ }}` interpolation.
- **`@json:` / `$.…`** — JSONPath over a JSON response. Properties, indices
  (negative counts from the end), `[*]`, and `..name` descent. Filter
  expressions are deliberately refused: they are a scripting surface inside
  the declarative half of the language.
- **`:regex`** over the response text.
- **Combinators** — `||` (first non-empty), `&&` (concatenate), `%%`
  (interleave) — and `##pattern##replacement` post-processing, with `###` for
  replace-first.
- **`@put:{k:rule}` / `@get:{k}`** for a value lifted out of one field and used
  in another.
- **`searchUrl` + `ruleSearch`**, **`exploreUrl` + `ruleExplore` +
  `ruleTrackList`**, and **`ruleStream`**.
- **The catalogue round trip.** A search's rows are cached, and each item's
  raw payload with them, so `ruleStream` still resolves after a restart
  without re-running the search (docs/06 §4).
- **`@js:` and `{{@js:…}}`**, with `jsLib` and the full `src` host surface
  (docs/06 §8) — so a Subsonic document computes its own auth query.
- **Sessions.** The source variable, a persistent per-source cookie jar, and
  sign-out that leaves none of it behind.

So `direct-url.json`, `subsonic.json` and `podcast-json-feed.json` all run.

Not yet: **`@css:`** and **`@xpath:`** need a markup parser, and so do
`src.parse.html` / `src.parse.xml` — which is why the podcast fixture is a
JSON Feed rather than RSS. A fixture that cannot run is a fixture that stops
telling the truth. A document using one of them imports fine
and reports the affected capability as absent — the runtime raises
`RuleEngineUnavailableError` rather than returning nothing, because silence
there reads as "the backend changed" and sends an author to the wrong fix. It
is a `RuleError`, so it carries the block and field it came from and the
tracer can point at the line rather than at the source as a whole.
Every rule block now runs.

Adding a document here is not how a *user* adds a source: they paste a string
into Settings → Sources → Import (docs/06 §9).
