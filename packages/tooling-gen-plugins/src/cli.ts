#!/usr/bin/env node
/** `pnpm gen:plugins` — regenerate both shells' static registries. */
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { generate } from './index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

for (const target of ['mobile', 'desktop'] as const) {
  const outDir = join(root, 'apps', target === 'mobile' ? 'mobile' : 'desktop', 'generated')
  await mkdir(outDir, { recursive: true })
  const written = await generate({ root, target, outFile: join(outDir, 'plugins.ts') })
  console.log(`generated ${written}`)
}
