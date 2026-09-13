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
})
