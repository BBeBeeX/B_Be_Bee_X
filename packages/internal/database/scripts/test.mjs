import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const scriptDir = fileURLToPath(new URL(".", import.meta.url))
const packageDir = fileURLToPath(new URL("..", import.meta.url))
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

const result = spawnSync(command, ["test"], {
  cwd: packageDir,
  stdio: "inherit",
  shell: false,
})

if (typeof result.status === "number") {
  process.exit(result.status)
}

if (result.error) {
  console.error(`Failed to run database tests from ${scriptDir}:`, result.error)
}

process.exit(1)
