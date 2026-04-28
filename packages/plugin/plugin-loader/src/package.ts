import type { InstalledPluginMetadata, PluginManifest, PluginSourceKind } from "@b_be_bee/plugin-sdk/manifest"
import type { SignatureVerifier } from "./signature"
import { verifyChecksum } from "./integrity"
import { assertPackageIdMatchesManifest, validatePluginManifest, type PluginValidationOptions } from "./validation"
import { verifyPluginSignature } from "./signature"

export interface PluginPackageFile {
  name: string
  content: string
}

export interface PluginPackageInput {
  filename: string
  files?: PluginPackageFile[]
  source?: string
}

export interface ParsedPluginPackage {
  code: string
  manifest: PluginManifest
  pluginId: string
  sourceKind: PluginSourceKind
}

export interface PluginCodeStore {
  delete: (assetId: string) => Promise<void>
  put: (input: { code: string; pluginId: string; sourceKind: PluginSourceKind }) => Promise<string>
}

const filenamePluginId = (filename: string) => filename.replace(/\.(zip|js)$/i, "")

const parseManifest = (content: string) => JSON.parse(content) as unknown

const parseEmbeddedManifest = (source: string) => {
  const match = source.match(/\/\*\s*manifest\s*([\s\S]*?)\s*\*\//)
  if (!match?.[1]) {
    throw new Error("Single-file plugins must include an embedded manifest block.")
  }
  return parseManifest(match[1])
}

export const parsePluginPackage = (
  input: PluginPackageInput,
  options: PluginValidationOptions,
): ParsedPluginPackage => {
  const pluginId = filenamePluginId(input.filename)
  if (input.filename.endsWith(".zip")) {
    const manifestFile = input.files?.find((file) => file.name === "manifest.json")
    const indexFile = input.files?.find((file) => file.name === "index.js")
    if (!manifestFile || !indexFile) {
      throw new Error("Zip plugins must contain manifest.json and index.js.")
    }
    const manifest = validatePluginManifest(parseManifest(manifestFile.content), options)
    assertPackageIdMatchesManifest(pluginId, manifest)
    return {
      code: indexFile.content,
      manifest,
      pluginId,
      sourceKind: "zip",
    }
  }

  if (input.filename.endsWith(".js")) {
    if (!input.source) {
      throw new Error("Single-file plugin source is required.")
    }
    const manifest = validatePluginManifest(parseEmbeddedManifest(input.source), options)
    assertPackageIdMatchesManifest(pluginId, manifest)
    return {
      code: input.source,
      manifest,
      pluginId,
      sourceKind: "single-file",
    }
  }

  throw new Error("Plugin packages must be .zip or .js files.")
}

export const installParsedPluginPackage = async (input: {
  codeStore: PluginCodeStore
  parsed: ParsedPluginPackage
  signatureVerifier?: SignatureVerifier
}) => {
  const checksum = await verifyChecksum(input.parsed.code, input.parsed.manifest.checksum)
  const signatureStatus = await verifyPluginSignature(
    {
      checksum,
      pluginId: input.parsed.pluginId,
      signature: input.parsed.manifest.signature,
    },
    input.signatureVerifier,
  )
  if (signatureStatus === "blocked") {
    throw new Error("Plugin signature verification failed.")
  }

  const now = Date.now()
  const codeAssetId = await input.codeStore.put({
    code: input.parsed.code,
    pluginId: input.parsed.pluginId,
    sourceKind: input.parsed.sourceKind,
  })

  return {
    checksum,
    codeAssetId,
    id: input.parsed.pluginId,
    installedAt: now,
    manifest: input.parsed.manifest,
    signature: input.parsed.manifest.signature,
    signatureStatus,
    sourceKind: input.parsed.sourceKind,
    state: "installed",
    updatedAt: now,
  } satisfies InstalledPluginMetadata
}
