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

The runtime ships as the M1 slice (docs/11 MD-7): a document is stored, given a
fiber, and resolved to a stream. Only `=` templates and `ruleStream` work.
`direct-url.json` is therefore the only document here that runs.

The selector engines (`@css:`, `@json:`, `@xpath:`), the combinators, `@js:`
and its sandbox, `searchUrl`/`exploreUrl` and every other rule block land with
M2 — and with them the Subsonic and podcast-feed documents this directory is
meant to hold.

Adding a document here is not how a *user* adds a source: they paste a string
into Settings → Sources → Import (docs/06 §9).
