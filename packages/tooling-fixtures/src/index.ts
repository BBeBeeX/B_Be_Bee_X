/**
 * `@BBeBee/tooling-fixtures` — the harnesses M1's exit criteria are checked
 * with.
 *
 * Dev-only: never published, never bundled into either shell. Everything here
 * exists because a criterion with no named check is an intention rather than a
 * criterion (docs/11 §6).
 *
 * - `generateCorpus` — the ≥ 5,000 file library, plus the pathological files a
 *   real one always contains.
 * - `countingFs` — an instrumented `ctx.fs`, because "an unchanged rescan costs
 *   stat calls only" is a claim about which methods were called.
 * - `startByteServer` — a real socket that honours `Range`, delays and stalls,
 *   which is what `httpConformance` runs against.
 */

export { generateCorpus, type Corpus, type CorpusOptions } from './corpus.js'
export { countingFs, type CountingFs, type CountedMethod, type FsCounts } from './counting-fs.js'
export { startByteServer, type ByteServer, type ByteServerOptions } from './byte-server.js'
export { flacFile, mp3File, TINY_PNG, type TagValues } from './audio-files.js'
