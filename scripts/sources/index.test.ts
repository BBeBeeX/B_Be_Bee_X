import { rm, mkdir, writeFile, readFile, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { compileSource, buildSources, unpackSource } from './index.ts'

describe('scripts/sources', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'bbebee-sources-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('compiles source.json and source.js into a single document', async () => {
    const srcDir = join(tmp, 'my-source')
    await mkdir(srcDir, { recursive: true })

    await writeFile(
      join(srcDir, 'source.json'),
      JSON.stringify({
        sourceUrl: 'https://example.com',
        sourceName: 'Example',
        ruleStream: {
          url: 'https://example.com/audio.mp3',
          qualities: ['normal', 'high'],
        },
      }),
      'utf8',
    )

    await writeFile(
      join(srcDir, 'source.js'),
      'function helper() { return 42; }',
      'utf8',
    )

    const outFile = join(tmp, 'out', 'my-source.json')
    const compiled = await compileSource({ sourceDir: srcDir, outFile })
    const parsed = JSON.parse(compiled)

    expect(parsed.sourceName).toBe('Example')
    expect(parsed.jsLib).toBe('function helper() { return 42; }')
    expect(parsed.ruleStream.qualities).toEqual(['normal', 'high'])

    const fileContent = await readFile(outFile, 'utf8')
    expect(JSON.parse(fileContent)).toEqual(parsed)
  })

  it('throws validation error if qualities contains invalid values', async () => {
    const srcDir = join(tmp, 'bad-source')
    await mkdir(srcDir, { recursive: true })

    await writeFile(
      join(srcDir, 'source.json'),
      JSON.stringify({
        sourceUrl: 'https://example.com',
        sourceName: 'Bad',
        ruleStream: {
          url: 'https://example.com/audio.mp3',
          qualities: ['invalid_quality'],
        },
      }),
      'utf8',
    )

    await expect(compileSource({ sourceDir: srcDir })).rejects.toThrow(/qualities/)
  })

  it('unpacks a single file document into source.json and source.js', async () => {
    const singleFile = join(tmp, 'combined.json')
    await writeFile(
      singleFile,
      JSON.stringify({
        sourceUrl: 'https://example.com',
        sourceName: 'Combined',
        jsLib: 'const x = 1;',
      }),
      'utf8',
    )

    const outDir = join(tmp, 'unpacked')
    const res = await unpackSource({ jsonFile: singleFile, outDir })

    const json = JSON.parse(await readFile(res.jsonFile, 'utf8'))
    expect(json.sourceName).toBe('Combined')
    expect(json.jsLib).toBeUndefined()

    expect(res.jsFile).toBeDefined()
    const js = (await readFile(res.jsFile!, 'utf8')).trim()
    expect(js).toBe('const x = 1;')
  })

  it('buildSources processes multiple source folders', async () => {
    const sourcesRoot = join(tmp, 'sources')
    const outRoot = join(tmp, 'fixtures')

    const s1 = join(sourcesRoot, 'src1')
    const s2 = join(sourcesRoot, 'src2')
    await mkdir(s1, { recursive: true })
    await mkdir(s2, { recursive: true })

    await writeFile(
      join(s1, 'source.json'),
      JSON.stringify({
        sourceUrl: 'https://s1.com',
        sourceName: 'S1',
        ruleStream: { url: 'https://s1.com/stream' },
      }),
    )
    await writeFile(
      join(s2, 'source.json'),
      JSON.stringify({
        sourceUrl: 'https://s2.com',
        sourceName: 'S2',
        ruleStream: { url: 'https://s2.com/stream' },
      }),
    )

    const written = await buildSources({ sourcesDir: sourcesRoot, outDir: outRoot })
    expect(written.length).toBe(2)

    const s1Out = JSON.parse(await readFile(join(outRoot, 'src1.json'), 'utf8'))
    const s2Out = JSON.parse(await readFile(join(outRoot, 'src2.json'), 'utf8'))
    expect(s1Out.sourceName).toBe('S1')
    expect(s2Out.sourceName).toBe('S2')
  })

  it('compiles a lyric source folder with source.js inlined as the script', async () => {
    const srcDir = join(tmp, 'lrclib')
    await mkdir(srcDir, { recursive: true })

    await writeFile(
      join(srcDir, 'source.json'),
      JSON.stringify({
        id: 'builtin-lrclib',
        name: 'LRCLIB',
        version: '1.4.0',
        allowedHosts: ['lrclib.net'],
      }),
      'utf8',
    )
    await writeFile(
      join(srcDir, 'source.js'),
      'async function searchLyrics(query) { return query.title; }',
      'utf8',
    )

    const outFile = join(tmp, 'lyric-fixtures', 'lrclib.json')
    const compiled = await compileSource({ sourceDir: srcDir, outFile })
    const parsed = JSON.parse(compiled)

    expect(parsed.id).toBe('builtin-lrclib')
    expect(parsed.jsLib).toBeUndefined()
    expect(parsed.script).toBe('async function searchLyrics(query) { return query.title; }')
  })

  it('rejects a lyric source document without a script', async () => {
    const srcDir = join(tmp, 'lyric-no-script')
    await mkdir(srcDir, { recursive: true })

    await writeFile(
      join(srcDir, 'source.json'),
      JSON.stringify({ id: 'no-script', name: 'No Script' }),
      'utf8',
    )

    await expect(compileSource({ sourceDir: srcDir })).rejects.toThrow(/script/)
  })

  it('routes lyric fixtures to lyricOutDir and emits the generated TS module', async () => {
    const sourcesRoot = join(tmp, 'sources')
    const outRoot = join(tmp, 'fixtures')
    const lyricOutRoot = join(tmp, 'lyric-fixtures')
    const codegenFile = join(tmp, 'generated', 'builtin-lyric-sources.generated.ts')

    const music = join(sourcesRoot, 'music-src')
    const lyric = join(sourcesRoot, 'lrclib')
    await mkdir(music, { recursive: true })
    await mkdir(lyric, { recursive: true })

    await writeFile(
      join(music, 'source.json'),
      JSON.stringify({
        sourceUrl: 'https://music.com',
        sourceName: 'Music',
        ruleStream: { url: 'https://music.com/stream' },
      }),
    )
    await writeFile(
      join(lyric, 'source.json'),
      JSON.stringify({ id: 'builtin-lrclib', name: 'LRCLIB', version: '1.4.0' }),
    )
    await writeFile(join(lyric, 'source.js'), 'async function searchLyrics() { return null; }')

    const written = await buildSources({
      sourcesDir: sourcesRoot,
      outDir: outRoot,
      lyricOutDir: lyricOutRoot,
      lyricCodegenFile: codegenFile,
    })
    expect(written).toHaveLength(2)
    expect(written).toContain(join(lyricOutRoot, 'lrclib.json'))
    expect(written).toContain(join(outRoot, 'music-src.json'))

    // Lyric fixtures never leak into the music output directory.
    expect(JSON.parse(await readFile(join(outRoot, 'music-src.json'), 'utf8')).jsLib).toBeUndefined()
    await expect(readFile(join(outRoot, 'lrclib.json'), 'utf8')).rejects.toThrow()

    const codegen = await readFile(codegenFile, 'utf8')
    expect(codegen).toContain('BUILTIN_LYRIC_SOURCES')
    expect(codegen).toContain('async function searchLyrics() { return null; }')
  })

  it('unpacks a lyric document back into source.json and source.js', async () => {
    const singleFile = join(tmp, 'lyric.json')
    await writeFile(
      singleFile,
      JSON.stringify({
        id: 'builtin-lrclib',
        name: 'LRCLIB',
        script: 'async function searchLyrics() { return null; }',
      }),
      'utf8',
    )

    const outDir = join(tmp, 'unpacked-lyric')
    const res = await unpackSource({ jsonFile: singleFile, outDir })

    const json = JSON.parse(await readFile(res.jsonFile, 'utf8'))
    expect(json.name).toBe('LRCLIB')
    expect(json.script).toBeUndefined()

    const js = (await readFile(res.jsFile!, 'utf8')).trim()
    expect(js).toBe('async function searchLyrics() { return null; }')
  })
})
