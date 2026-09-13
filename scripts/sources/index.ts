import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { validateSourceDocument } from './validator.ts'
import type { SourceDocument } from '@BBeBee/protocol'

export interface CompileSourceOptions {
  /** Directory containing source.json and optional source.js */
  sourceDir: string
  /** Destination file path for compiled JSON. If omitted, file is not written. */
  outFile?: string
  /** Whether to run validateSourceDocument. Defaults to true. */
  validate?: boolean
}

export interface BuildSourcesOptions {
  /** Root directory containing source folders. Defaults to <repo>/sources */
  sourcesDir: string
  /** Output directory for compiled JSON fixtures. Defaults to <repo>/fixtures/sources */
  outDir: string
  /** Whether to run validateSourceDocument. Defaults to true. */
  validate?: boolean
}

export interface UnpackSourceOptions {
  /** Path to the single-file source JSON to unpack */
  jsonFile: string
  /** Destination directory for the unpacked files */
  outDir: string
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

/**
 * Compiles a single source folder (source.json + optional source.js) into a self-contained SourceDocument JSON.
 */
export async function compileSource(opts: CompileSourceOptions): Promise<string> {
  const dirName = basename(opts.sourceDir)

  // 1. Locate JSON definition: source.json, <dirName>.json, or source.meta.json
  const jsonCandidates = [
    join(opts.sourceDir, 'source.json'),
    join(opts.sourceDir, `${dirName}.json`),
    join(opts.sourceDir, 'source.meta.json'),
  ]

  let jsonPath: string | undefined
  for (const candidate of jsonCandidates) {
    if (await fileExists(candidate)) {
      jsonPath = candidate
      break
    }
  }

  if (!jsonPath) {
    throw new Error(`No source JSON found in ${opts.sourceDir}. Expected one of: source.json, ${dirName}.json`)
  }

  const rawJson = await readFile(jsonPath, 'utf8')
  let doc: SourceDocument
  try {
    doc = JSON.parse(rawJson)
  } catch (err) {
    throw new Error(
      `Failed to parse JSON in ${jsonPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }

  // 2. Locate optional JavaScript file: source.js or <dirName>.js
  const jsCandidates = [
    join(opts.sourceDir, 'source.js'),
    join(opts.sourceDir, `${dirName}.js`),
  ]

  let jsPath: string | undefined
  for (const candidate of jsCandidates) {
    if (await fileExists(candidate)) {
      jsPath = candidate
      break
    }
  }

  if (jsPath) {
    const jsContent = (await readFile(jsPath, 'utf8')).trim()
    if (jsContent.length > 0) {
      doc.jsLib = jsContent
    }
  }

  // 3. Validate document
  if (opts.validate !== false) {
    try {
      validateSourceDocument(doc)
    } catch (err) {
      throw new Error(
        `Validation failed for source in ${opts.sourceDir}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  const outputContent = JSON.stringify(doc, null, 2) + '\n'

  // 4. Write output if requested
  if (opts.outFile) {
    await mkdir(resolve(opts.outFile, '..'), { recursive: true })
    await writeFile(opts.outFile, outputContent, 'utf8')
  }

  return outputContent
}

/**
 * Scans a directory of source folders and compiles each into a single-file JSON in outDir.
 */
export async function buildSources(opts: BuildSourcesOptions): Promise<string[]> {
  const entries = await readdir(opts.sourcesDir, { withFileTypes: true })
  const sourceDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .map((e) => join(opts.sourcesDir, e.name))

  const writtenFiles: string[] = []

  for (const sourceDir of sourceDirs) {
    const id = basename(sourceDir)
    const outFile = join(opts.outDir, `${id}.json`)
    await compileSource({
      sourceDir,
      outFile,
      validate: opts.validate,
    })
    writtenFiles.push(outFile)
  }

  return writtenFiles
}

/**
 * Unpacks a single-file SourceDocument JSON into source.json and optional source.js in outDir.
 */
export async function unpackSource(opts: UnpackSourceOptions): Promise<{ jsonFile: string; jsFile?: string }> {
  const raw = await readFile(opts.jsonFile, 'utf8')
  const doc = JSON.parse(raw)

  await mkdir(opts.outDir, { recursive: true })

  let jsFile: string | undefined
  if (typeof doc.jsLib === 'string' && doc.jsLib.trim().length > 0) {
    jsFile = join(opts.outDir, 'source.js')
    await writeFile(jsFile, doc.jsLib.trim() + '\n', 'utf8')
    delete doc.jsLib
  }

  const jsonFile = join(opts.outDir, 'source.json')
  await writeFile(jsonFile, JSON.stringify(doc, null, 2) + '\n', 'utf8')

  return { jsonFile, jsFile }
}
