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
// pnpm's store is symlinked; Metro must follow rather than duplicate.
config.resolver.disableHierarchicalLookup = true

module.exports = config
