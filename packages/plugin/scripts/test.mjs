import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const read = (path) => readFileSync(join(root, path), "utf8")

const manifest = read("src/manifest.ts")
assert.match(manifest, /apiVersion/)
assert.match(manifest, /music-source/)
assert.match(manifest, /ui-extension/)
assert.match(manifest, /service/)
assert.match(manifest, /isolated-vm/)
assert.match(manifest, /worker/)
assert.match(manifest, /bridge/)
assert.match(manifest, /checksum/)
assert.match(manifest, /signature/)
assert.match(manifest, /installed/)
assert.match(manifest, /running/)
assert.match(manifest, /PluginNetworkRequest/)

const musicSource = read("src/music-source.ts")
assert.match(musicSource, /MusicSourceCapabilities/)
assert.match(musicSource, /cookieAuth/)
assert.match(musicSource, /getHotTracks/)
assert.match(musicSource, /getUserLibrary/)
assert.match(musicSource, /trackToAudioInfo/)
assert.match(musicSource, /getAudioPlayInfo/)
assert.match(musicSource, /AUTH_REQUIRED/)
assert.match(musicSource, /assertMusicSourcePlugin/)

const validation = read("src/validation.ts")
assert.match(validation, /packages\/internal/)
assert.match(validation, /fetch/)
assert.match(validation, /XMLHttpRequest/)
assert.match(validation, /process/)

const pkg = read("src/package.ts")
assert.match(pkg, /manifest\.json/)
assert.match(pkg, /index\.js/)
assert.match(pkg, /verifyChecksum/)
assert.match(pkg, /verifyPluginSignature/)

const runtime = read("src/runtime.ts")
assert.match(runtime, /onError/)
assert.match(runtime, /loadEnabledOnStartup/)
assert.match(runtime, /assertPluginStateTransition/)

const host = read("src/host.ts")
assert.match(host, /assertNetworkAllowed/)
assert.match(host, /assertStorageAllowed/)
assert.match(host, /assertAuthAllowed/)
assert.match(host, /assertProxyAllowed/)
assert.match(host, /useAuth/)
assert.match(host, /Authorization/)

const sandbox = read("src/sandbox.ts")
assert.match(sandbox, /validateMusicSourcePlugin/)

const index = read("src/index.ts")
assert.match(index, /music-source/)

console.log("Plugin package source validation passed.")
