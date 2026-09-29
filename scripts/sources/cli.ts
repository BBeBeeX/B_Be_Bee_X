#!/usr/bin/env node
/**
 * `pnpm build:sources` — compile multi-file sources in `sources/` into
 * self-contained single-file JSONs: music sources into `fixtures/sources/`,
 * lyric sources into `fixtures/lyric-sources/` (bundled into a generated TS
 * module for `plugin-lyric-sources` to import).
 */
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { watch } from 'node:fs'
import { buildSources, unpackSource } from './index.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const defaultSourcesDir = join(repoRoot, 'sources')
const defaultOutDir = join(repoRoot, 'fixtures', 'sources')
const defaultLyricCodegenFile = join(
  repoRoot,
  'packages',
  'feature',
  'plugin-lyric-sources',
  'src',
  'generated',
  'builtin-lyric-sources.generated.ts',
)

const args = process.argv.slice(2)

let isWatch = false
let unpackTarget: string | undefined
let unpackDest: string | undefined
let customSourcesDir: string | undefined
let customOutDir: string | undefined

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--watch' || arg === '-w') {
    isWatch = true
  } else if (arg === '--unpack' && i + 1 < args.length) {
    unpackTarget = args[++i]
    if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
      unpackDest = args[++i]
    }
  } else if (arg === '--sources' && i + 1 < args.length) {
    customSourcesDir = args[++i]
  } else if (arg === '--out' && i + 1 < args.length) {
    customOutDir = args[++i]
  }
}

const sourcesDir = customSourcesDir ? resolve(process.cwd(), customSourcesDir) : defaultSourcesDir
const outDir = customOutDir ? resolve(process.cwd(), customOutDir) : defaultOutDir
// Lyric fixtures live next to the music ones: fixtures/sources → fixtures/lyric-sources.
const lyricOutDir = join(resolve(outDir, '..'), 'lyric-sources')
const lyricCodegen = defaultLyricCodegenFile

async function runBuild() {
  try {
    const written = await buildSources({
      sourcesDir,
      outDir,
      lyricOutDir,
      lyricCodegenFile: lyricCodegen,
      validate: true,
    })
    console.log(`[build:sources] Successfully compiled ${written.length} source(s):`)
    for (const f of written) {
      console.log(`  - ${f}`)
    }
    if (lyricCodegen) {
      console.log(`[build:sources] Generated lyric-source module: ${lyricCodegen}`)
    }
  } catch (err) {
    console.error(`[build:sources] Error: ${err instanceof Error ? err.message : String(err)}`)
    if (!isWatch) {
      process.exitCode = 1
    }
  }
}

if (unpackTarget) {
  const targetPath = resolve(process.cwd(), unpackTarget)
  const destDir = unpackDest ? resolve(process.cwd(), unpackDest) : join(sourcesDir, 'unpacked')
  console.log(`[unpack:source] Unpacking ${targetPath} -> ${destDir}...`)
  try {
    const res = await unpackSource({ jsonFile: targetPath, outDir: destDir })
    console.log(`[unpack:source] Created:`)
    console.log(`  - ${res.jsonFile}`)
    if (res.jsFile) console.log(`  - ${res.jsFile}`)
  } catch (err) {
    console.error(`[unpack:source] Failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
} else if (isWatch) {
  console.log(`[watch:sources] Watching ${sourcesDir} for changes...`)
  await runBuild()

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  watch(sourcesDir, { recursive: true }, (_eventType, filename) => {
    if (!filename || filename.startsWith('.') || filename.endsWith('~')) return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      console.log(`[watch:sources] Change detected in ${filename}, recompiling...`)
      await runBuild()
    }, 150)
  })
} else {
  await runBuild()
}
