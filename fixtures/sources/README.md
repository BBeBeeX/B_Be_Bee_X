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
- **`searchUrl` + `ruleSearch`**, and **`ruleStream`**.

So `direct-url.json` and `subsonic.json` both run.

Not yet: **`@css:`** and **`@xpath:`** need a markup parser, and **`@js:`**
needs `ctx.js` (docs/04 §19). A document using one of them imports fine and
reports the affected capability as absent — the runtime says
`RuleEngineUnavailableError` rather than returning nothing, because silence
there reads as "the backend changed" and sends an author to the wrong fix.
`ruleExplore`, `ruleAlbum`, `ruleTrackList` and `ruleLyric` are parsed and
stored but not yet run.

Adding a document here is not how a *user* adds a source: they paste a string
into Settings → Sources → Import (docs/06 §9).
