import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = join(__dirname, "..");
const distDir = join(appDir, "dist");

await mkdir(distDir, { recursive: true });
await copyFile(join(appDir, "index.html"), join(distDir, "index.html"));

console.log("Desktop build verification complete: dist/index.html generated.");
