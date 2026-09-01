// Metro configuration for the BBeBee mobile shell.
//
// Two settings are load-bearing, both flagged in docs/04 §17:
//
//   unstable_enablePackageExports — `cordis` is ESM-only with an `exports`
//     map. Without this Metro cannot resolve it at all.
//   watchFolders — the workspace packages live outside this app directory.
//
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '../..')
const config = getDefaultConfig(__dirname)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.unstable_enablePackageExports = true
config.resolver.unstable_conditionNames = ['react-native', 'import', 'require', 'default']
// The workspace is ESM TypeScript: a relative `./foo.js` specifier means
// `./foo.ts` on disk. Vite and vitest apply that rewrite themselves; Metro
// does not, so `@BBeBee/*` sources do not resolve without it. Tried only
// after normal resolution fails, so nothing that already resolves changes.
const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest
  try {
    return resolve(context, moduleName, platform)
  } catch (error) {
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      return resolve(context, moduleName.slice(0, -'.js'.length), platform)
    }
    throw error
  }
}

// Hierarchical lookup stays **on**, which is the opposite of the usual monorepo
// advice: pnpm gives each package its own `.pnpm/<pkg>/node_modules` holding
// that package's dependencies, and walking up from a resolved real path is the
// only way to reach them. `nodeModulesPaths` above covers the app's own
// imports; without the walk-up, `expo` cannot resolve `expo-modules-core`.

module.exports = config
