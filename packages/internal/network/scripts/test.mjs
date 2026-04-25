import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))

const read = (path) => readFileSync(join(root, path), "utf8")

const pluginValidation = read("src/pluginValidation.ts")
assert.match(pluginValidation, /fetch/)
assert.match(pluginValidation, /XMLHttpRequest/)
assert.match(pluginValidation, /node:http/)
assert.match(pluginValidation, /node:https/)
assert.match(pluginValidation, /axios/)

const proxy = read("src/proxy.ts")
assert.match(proxy, /Direct requests are blocked by proxy policy/)
assert.match(proxy, /Proxy routing is required/)

const cache = read("src/cache.ts")
assert.match(cache, /plugin:\$\{context\.pluginId\}/)

const logging = read("src/logging.ts")
assert.match(logging, /authorization/)
assert.match(logging, /proxy-authorization/)
assert.match(logging, /credential/)

const retry = read("src/retry.ts")
assert.match(retry, /retryUnsafeMethods/)

console.log("Network package source validation passed.")
