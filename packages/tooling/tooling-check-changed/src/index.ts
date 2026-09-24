import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface WorkspacePackage {
  name: string
  dir: string
  hasTypecheck: boolean
  hasTest: boolean
}

export interface DiffResult {
  base: string
  files: string[]
  isClean: boolean
}

export interface AnalysisResult {
  changedPackages: WorkspacePackage[]
  typecheckPackages: WorkspacePackage[]
  testPackages: WorkspacePackage[]
  testFiles: string[]
  lintFiles: string[]
  codeFiles: string[]
  hasCodeChanges: boolean
  rootTypecheck: boolean
  rootLint: boolean
  rootTest: boolean
}

export interface CheckChangedOptions {
  root: string
  since?: string
  fix?: boolean
  all?: boolean
  typecheckOnly?: boolean
  lintOnly?: boolean
  testOnly?: boolean
  timeout?: number
  related?: boolean
}

const ROOT_TYPECHECK_CONFIGS = new Set([
  'tsconfig.json',
  'tsconfig.base.json',
  'pnpm-workspace.yaml',
])

const ROOT_LINT_CONFIGS = new Set(['eslint.config.js'])

const ROOT_TEST_CONFIGS = new Set(['vitest.config.ts', 'vitest.global.ts'])

const CODE_EXTENSIONS = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/
const TYPECHECK_EXTENSIONS = /\.(tsx?|jsx?|mts|cts|mjs|cjs|json)$/
const LINTABLE_EXTENSIONS = /\.(tsx?|jsx?|mjs|cjs)$/

const IGNORED_PATH_SEGMENTS = ['/dist/', '/out/', '/generated/', '/node_modules/']

function packageHasTests(root: string, relDir: string): boolean {
  const dir = join(root, relDir)
  if (!existsSync(dir)) return false
  const queue = [dir]
  while (queue.length > 0) {
    const current = queue.pop()!
    try {
      const entries = readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (
            entry.name !== 'node_modules' &&
            entry.name !== 'dist' &&
            entry.name !== 'out' &&
            entry.name !== '.git'
          ) {
            queue.push(join(current, entry.name))
          }
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx'))
        ) {
          return true
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }
  return false
}

/**
 * Scan the workspace root to discover all packages and apps with package.json.
 */
export function findWorkspacePackages(root: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = []

  const checkDir = (relDir: string) => {
    const pkgJsonPath = join(root, relDir, 'package.json')
    if (!existsSync(pkgJsonPath)) return
    try {
      const raw = readFileSync(pkgJsonPath, 'utf8')
      const json = JSON.parse(raw) as { name?: string; scripts?: Record<string, string> }
      if (!json.name) return
      packages.push({
        name: json.name,
        dir: relDir.replace(/\\/g, '/'),
        hasTypecheck: Boolean(json.scripts?.typecheck),
        hasTest: Boolean(json.scripts?.test) || packageHasTests(root, relDir),
      })
    } catch {
      // Ignore unparseable package.json
    }
  }

  // Scan packages/* and packages/*/*
  const packagesRoot = join(root, 'packages')
  if (existsSync(packagesRoot)) {
    for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      checkDir(`packages/${entry.name}`)
      const subLayer = join(packagesRoot, entry.name)
      for (const sub of readdirSync(subLayer, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          checkDir(`packages/${entry.name}/${sub.name}`)
        }
      }
    }
  }

  // Scan apps/*
  const appsRoot = join(root, 'apps')
  if (existsSync(appsRoot)) {
    for (const entry of readdirSync(appsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        checkDir(`apps/${entry.name}`)
      }
    }
  }

  // Sort descending by directory path length so deeper packages match first
  return packages.sort((a, b) => b.dir.length - a.dir.length)
}

function execGit(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/**
 * Determine the base commit and files changed in the current diff.
 */
export function resolveGitDiff(root: string, since?: string): DiffResult {
  let base = since

  if (!base) {
    const status = execGit('status --porcelain -u', root)
    const currentBranch = execGit('rev-parse --abbrev-ref HEAD', root)
    const isFeatureBranch =
      currentBranch &&
      currentBranch !== 'main' &&
      currentBranch !== 'master' &&
      currentBranch !== 'HEAD'

    let mergeBase = ''
    if (isFeatureBranch) {
      for (const candidate of ['origin/main', 'main', 'origin/master', 'master']) {
        mergeBase = execGit(`merge-base HEAD ${candidate}`, root)
        if (mergeBase) break
      }
    }

    if (status) {
      // Uncommitted changes exist.
      // If on feature branch with a valid merge-base, diff against merge-base (includes branch commits + uncommitted)
      // Otherwise diff against HEAD
      base = isFeatureBranch && mergeBase ? mergeBase : 'HEAD'
    } else {
      // Working tree is clean.
      if (isFeatureBranch && mergeBase) {
        base = mergeBase
      } else {
        // Fall back to latest commit
        base = 'HEAD~1'
      }
    }
  }

  // Get diff against base
  const diffOutput = execGit(`diff --name-only ${base}`, root)
  const untrackedOutput = execGit('ls-files --others --exclude-standard', root)

  const fileSet = new Set<string>()
  for (const line of `${diffOutput}\n${untrackedOutput}`.split('\n')) {
    const file = line.trim().replace(/\\/g, '/')
    if (file) {
      fileSet.add(file)
    }
  }

  const files = Array.from(fileSet)
  return {
    base,
    files,
    isClean: files.length === 0,
  }
}

/**
 * Analyze changed files and categorize them for the gate steps.
 */
export function analyzeChanges(
  root: string,
  files: string[],
  packages: WorkspacePackage[],
  base?: string,
): AnalysisResult {
  let rootTypecheck = files.some((f) => ROOT_TYPECHECK_CONFIGS.has(f))
  if (!rootTypecheck && files.includes('package.json') && base) {
    const diff = execGit(`diff ${base} -- package.json`, root)
    if (/"(dependencies|devDependencies|peerDependencies)"/.test(diff)) {
      rootTypecheck = true
    }
  }
  const rootLint = files.some((f) => ROOT_LINT_CONFIGS.has(f))
  const rootTest = files.some((f) => ROOT_TEST_CONFIGS.has(f))

  const changedPkgSet = new Set<WorkspacePackage>()
  const typecheckPkgSet = new Set<WorkspacePackage>()
  const testPkgSet = new Set<WorkspacePackage>()
  const testFiles: string[] = []
  const lintFiles: string[] = []
  const codeFiles: string[] = []

  let shellsChanged = false

  for (const file of files) {
    const fullPath = join(root, file)
    const exists = existsSync(fullPath)

    if (exists && CODE_EXTENSIONS.test(file)) {
      codeFiles.push(file)
    }

    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) {
      testFiles.push(file)
    }

    if (file.includes('plugins.ts') || file.endsWith('BBeBee.plugin.json')) {
      shellsChanged = true
    }

    // Check lintability
    const isIgnored = IGNORED_PATH_SEGMENTS.some((seg) => `/${file}/`.includes(seg))
    if (exists && LINTABLE_EXTENSIONS.test(file) && !isIgnored) {
      lintFiles.push(file)
    }

    // Match package
    const pkg = packages.find((p) => file === p.dir || file.startsWith(`${p.dir}/`))
    if (pkg) {
      changedPkgSet.add(pkg)
      if (
        pkg.hasTypecheck &&
        (TYPECHECK_EXTENSIONS.test(file) ||
          file.endsWith('/package.json') ||
          file.endsWith('/tsconfig.json'))
      ) {
        typecheckPkgSet.add(pkg)
      }
      if (
        pkg.hasTest &&
        (CODE_EXTENSIONS.test(file) || file.endsWith('/package.json'))
      ) {
        testPkgSet.add(pkg)
      }
    }
  }

  if (shellsChanged && existsSync(join(root, 'packages/kernel/src/bootstrap/shells.test.ts'))) {
    testFiles.push('packages/kernel/src/bootstrap/shells.test.ts')
  }

  const hasCodeChanges = codeFiles.length > 0

  return {
    changedPackages: Array.from(changedPkgSet),
    typecheckPackages: Array.from(typecheckPkgSet),
    testPackages: Array.from(testPkgSet),
    testFiles: Array.from(new Set(testFiles)),
    lintFiles,
    codeFiles,
    hasCodeChanges,
    rootTypecheck,
    rootLint,
    rootTest,
  }
}

/**
 * Main execution logic for pnpm check:changed.
 */
export function runCheckChanged(options: CheckChangedOptions): number {
  const root = resolve(options.root)
  const packages = findWorkspacePackages(root)
  const diff = resolveGitDiff(root, options.since)

  console.log(`[check:changed] Comparing against: ${diff.base}`)

  if (diff.isClean) {
    console.log('[check:changed] No changed files detected. Working tree is clean.')
    return 0
  }

  console.log(`[check:changed] Detected ${diff.files.length} changed file(s):`)
  for (const file of diff.files.slice(0, 15)) {
    console.log(`  • ${file}`)
  }
  if (diff.files.length > 15) {
    console.log(`  ... and ${diff.files.length - 15} more`)
  }

  const analysis = analyzeChanges(root, diff.files, packages, diff.base)

  if (analysis.changedPackages.length > 0) {
    console.log(`[check:changed] Affected packages (${analysis.changedPackages.length}):`)
    for (const pkg of analysis.changedPackages) {
      console.log(`  → ${pkg.name} (${pkg.dir})`)
    }
  }

  const runAll = !options.typecheckOnly && !options.lintOnly && !options.testOnly
  const doTypecheck = runAll || options.typecheckOnly
  const doLint = runAll || options.lintOnly
  const doTest = runAll || options.testOnly

  // Step 1: Typecheck
  if (doTypecheck) {
    console.log('\n[check:changed] Step 1/3: Typecheck')
    if (analysis.rootTypecheck && (options.all || analysis.typecheckPackages.length === 0)) {
      console.log('  Root compiler/workspace configs changed; running full typecheck across workspace...')
      const res = spawnSync('pnpm', ['typecheck'], { cwd: root, stdio: 'inherit' })
      if (res.status !== 0) return res.status ?? 1
    } else if (analysis.typecheckPackages.length > 0) {
      console.log(
        `  Typechecking ${analysis.typecheckPackages.length} affected package(s): ${analysis.typecheckPackages.map((p) => p.name).join(', ')}`,
      )
      const filterArgs = analysis.typecheckPackages.flatMap((p) => ['--filter', p.name])
      const res = spawnSync('pnpm', [...filterArgs, 'typecheck'], { cwd: root, stdio: 'inherit' })
      if (res.status !== 0) return res.status ?? 1
    } else {
      console.log('  Skipped: no code changes in typechecked packages.')
    }
  }

  // Step 2: Lint
  if (doLint) {
    console.log('\n[check:changed] Step 2/3: Lint')
    if (analysis.rootLint && options.all) {
      console.log('  eslint.config.js changed; running full repository lint...')
      const args = options.fix ? ['eslint', '.', '--fix'] : ['eslint', '.']
      const res = spawnSync('pnpm', ['exec', ...args], { cwd: root, stdio: 'inherit' })
      if (res.status !== 0) return res.status ?? 1
    } else if (analysis.lintFiles.length > 0) {
      console.log(`  Linting ${analysis.lintFiles.length} changed file(s)...`)
      const args = [
        'exec',
        'eslint',
        '--no-warn-ignored',
        ...(options.fix ? ['--fix'] : []),
        ...analysis.lintFiles,
      ]
      const res = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' })
      if (res.status !== 0) return res.status ?? 1
    } else {
      console.log('  Skipped: no lintable files changed.')
    }
  }

  // Step 3: Test
  if (doTest) {
    const testTimeout = options.timeout ?? 30_000
    console.log(`\n[check:changed] Step 3/3: Test (timeout: ${testTimeout}ms)`)
    const targets = Array.from(
      new Set([
        ...analysis.testPackages.map((p) => p.dir),
        ...analysis.testFiles,
      ]),
    )

    if (analysis.rootTest && options.all) {
      console.log('  Test configuration changed and --all specified; running full test suite...')
      const res = spawnSync(
        'pnpm',
        ['exec', 'vitest', 'run', `--testTimeout=${testTimeout}`],
        { cwd: root, stdio: 'inherit' },
      )
      if (res.status !== 0) return res.status ?? 1
    } else if (options.related) {
      console.log(`  Running tests related to ${analysis.codeFiles.length} changed code file(s)...`)
      const res = spawnSync(
        'pnpm',
        ['exec', 'vitest', 'related', '--run', ...analysis.codeFiles, '--passWithNoTests', `--testTimeout=${testTimeout}`],
        { cwd: root, stdio: 'inherit' },
      )
      if (res.status !== 0) return res.status ?? 1
    } else if (targets.length > 0) {
      console.log(`  Testing ${targets.length} affected package target(s): ${targets.join(', ')}`)
      const res = spawnSync(
        'pnpm',
        ['exec', 'vitest', 'run', ...targets, '--passWithNoTests', `--testTimeout=${testTimeout}`],
        { cwd: root, stdio: 'inherit' },
      )
      if (res.status !== 0) return res.status ?? 1
    } else if (analysis.rootTest) {
      console.log('  Root test configuration changed without package code changes.')
      console.log('  Skipped full test suite to keep diff check fast. (Pass --all or run "pnpm test" for full suite)')
    } else {
      console.log('  Skipped: no tests affected in modified packages.')
    }
  }

  console.log('\n[check:changed] All checks passed successfully!')
  return 0
}
