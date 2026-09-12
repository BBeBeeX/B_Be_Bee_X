# @BBeBee/toolkit

Pure helpers over ids, text, time and collections — the functions that were
living inside domain plugins and are needed by more than one of them.

The charter is the same as `source-rules`, the other package in this layer
without a `BBeBee.plugin.json`: **pure logic, no Cordis, no platform, no I/O,
no dependencies.** Nothing here holds state, starts a timer, or touches a
`ctx.*` service. A function that needs either belongs in a feature plugin, or
in a core service if the platform can provide it.

What belongs here:

- Stable identity (`stableId`, `trackId`, `artworkId`, …) — derived ids that
  must survive a rescan or a re-import.
- Text (`splitArtists`) — normalising the strings metadata sources write.
- Time (`formatDuration`) — the one way every shell renders a duration.
- Collections (`permute`) — deterministic, seed-driven ordering.

What does not: anything with a capability, a service key, a config schema, or
an opinion about where a file lives. Those are features, and features are
plugins.

Consumers import it directly — a pure library couples no lifecycles, so no
`inject` is needed. It is deliberately not a plugin: there is nothing to load,
enable or unload.
