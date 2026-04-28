import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const read = (path) => readFileSync(join(root, path), "utf8")

const pluginModels = read("../internal/models/src/plugin.ts")
assert.match(pluginModels, /apiVersion/)
assert.match(pluginModels, /music-source/)
assert.match(pluginModels, /ui-extension/)
assert.match(pluginModels, /service/)
assert.match(pluginModels, /isolated-vm/)
assert.match(pluginModels, /worker/)
assert.match(pluginModels, /bridge/)
assert.match(pluginModels, /checksum/)
assert.match(pluginModels, /signature/)
assert.match(pluginModels, /installed/)
assert.match(pluginModels, /running/)
assert.match(pluginModels, /AUTH_REQUIRED/)

const sdkManifest = read("../plugin-sdk/src/manifest.ts")
assert.match(sdkManifest, /@b_be_bee\/models/)
assert.match(sdkManifest, /pluginExecutionModels/)
assert.match(sdkManifest, /pluginStates/)
assert.match(sdkManifest, /pluginTypes/)
assert.match(sdkManifest, /PluginNetworkRequest/)

const sdkMusicSource = read("../plugin-sdk/src/music-source.ts")
assert.match(sdkMusicSource, /MusicSourceCapabilities/)
assert.match(sdkMusicSource, /cookieAuth/)
assert.match(sdkMusicSource, /getHotTracks/)
assert.match(sdkMusicSource, /getUserLibrary/)
assert.match(sdkMusicSource, /trackToAudioInfo/)
assert.match(sdkMusicSource, /getAudioPlayInfo/)
assert.match(sdkMusicSource, /assertMusicSourcePlugin/)

const manifest = read("src/manifest.ts")
assert.match(manifest, /@b_be_bee\/plugin-sdk\/manifest/)

const musicSource = read("src/music-source.ts")
assert.match(musicSource, /@b_be_bee\/plugin-sdk\/music-source/)

const validation = read("../plugin-loader/src/validation.ts")
assert.match(validation, /packages\/internal/)
assert.match(validation, /fetch/)
assert.match(validation, /XMLHttpRequest/)
assert.match(validation, /process/)

const pkg = read("../plugin-loader/src/package.ts")
assert.match(pkg, /manifest\.json/)
assert.match(pkg, /index\.js/)
assert.match(pkg, /verifyChecksum/)
assert.match(pkg, /verifyPluginSignature/)

const runtime = read("../plugin-runtime/src/runtime.ts")
assert.match(runtime, /onError/)
assert.match(runtime, /loadEnabledOnStartup/)
assert.match(runtime, /assertPluginStateTransition/)

const host = read("../plugin-host/src/host.ts")
assert.match(host, /assertNetworkAllowed/)
assert.match(host, /assertAuthAllowed/)
assert.match(host, /assertProxyAllowed/)
assert.match(host, /useAuth/)
assert.match(host, /Authorization/)

const sandbox = read("../plugin-runtime/src/sandbox.ts")
assert.match(sandbox, /validateMusicSourcePlugin/)

const index = read("src/index.ts")
assert.match(index, /music-source/)

const sdkPkg = read("../plugin-sdk/package.json")
const loaderPkg = read("../plugin-loader/package.json")
const hostPkg = read("../plugin-host/package.json")
assert.doesNotMatch(sdkPkg, /@b_be_bee\/database/)
assert.doesNotMatch(loaderPkg, /@b_be_bee\/database/)
assert.doesNotMatch(hostPkg, /@b_be_bee\/database/)

console.log("Plugin package source validation passed.")
