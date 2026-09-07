#!/usr/bin/env node
/** `pnpm new:plugin --name scrobble --kind feature --ui desktop` */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { create, type PluginKind, type UiTarget } from './index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const name = flag('name')
if (!name) {
  console.error(`usage: pnpm new:plugin --name <slug> [--kind feature|effect]
                        [--ui none|desktop|mobile|both] [--capabilities a,b]

  --name          lowercase, hyphenated, no prefix (e.g. "scrobble")
  --kind          feature (default) | effect — decides the package prefix.
                  There is no "source" kind: a music backend is an imported
                  document, not a package (docs/06).
  --ui            which view packages to emit (default: none)
  --capabilities  comma-separated, e.g. "db:own,net:host/*.example.org"
`)
  process.exit(1)
}

const capabilities = (flag('capabilities') ?? '').split(',').map((c) => c.trim()).filter(Boolean)

try {
  const written = await create({
    root,
    name,
    kind: (flag('kind', 'feature') as PluginKind) ?? 'feature',
    ui: (flag('ui', 'none') as UiTarget) ?? 'none',
    capabilities,
  })
  console.log(`created ${written.length} files:`)
  for (const path of written) console.log(`  ${path}`)
  console.log(`
Next:
  pnpm install          link the new workspace package
  pnpm gen:plugins      add it to both shells' static registries
  pnpm check            typecheck, lint and test — should already be green`)
} catch (error) {
  console.error(`new:plugin failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
