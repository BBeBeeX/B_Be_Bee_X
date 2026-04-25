import { pluginExecutionModels, pluginTypes, type PluginManifest } from "./manifest"

export interface PluginValidationOptions {
  appVersion: string
  supportedApiVersions: string[]
  supportedExecutionModels?: readonly string[]
}

export const compareVersions = (left: string, right: string) => {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

export const isPluginManifest = (value: unknown): value is PluginManifest => {
  if (!value || typeof value !== "object") return false
  const manifest = value as Partial<PluginManifest>
  return (
    typeof manifest.id === "string" &&
    typeof manifest.name === "string" &&
    typeof manifest.version === "string" &&
    typeof manifest.apiVersion === "string" &&
    typeof manifest.minAppVersion === "string" &&
    typeof manifest.checksum === "string" &&
    typeof manifest.signature === "string" &&
    pluginTypes.includes(manifest.type as PluginManifest["type"]) &&
    pluginExecutionModels.includes(manifest.executionModel as PluginManifest["executionModel"]) &&
    isStringArray(manifest.capabilities) &&
    isStringArray(manifest.scopes) &&
    Boolean(manifest.permissions) &&
    isStringArray(manifest.permissions?.network) &&
    isStringArray(manifest.permissions?.storage) &&
    typeof manifest.permissions?.auth === "boolean" &&
    typeof manifest.permissions?.proxy === "boolean"
  )
}

export const validatePluginManifest = (
  manifest: unknown,
  options: PluginValidationOptions,
): PluginManifest => {
  if (!isPluginManifest(manifest)) {
    throw new Error("Invalid plugin manifest.")
  }
  if (compareVersions(options.appVersion, manifest.minAppVersion) < 0) {
    throw new Error(`Plugin requires app version ${manifest.minAppVersion}.`)
  }
  if (!options.supportedApiVersions.includes(manifest.apiVersion)) {
    throw new Error(`Unsupported plugin API version ${manifest.apiVersion}.`)
  }
  if (
    options.supportedExecutionModels &&
    !options.supportedExecutionModels.includes(manifest.executionModel)
  ) {
    throw new Error(`Unsupported plugin execution model ${manifest.executionModel}.`)
  }
  return manifest
}

export const assertPackageIdMatchesManifest = (packagePluginId: string, manifest: PluginManifest) => {
  if (packagePluginId !== manifest.id) {
    throw new Error(`Plugin package id ${packagePluginId} does not match manifest id ${manifest.id}.`)
  }
}

export interface PluginStaticViolation {
  index: number
  message: string
  pattern: string
}

const bannedPatterns = [
  { message: "Plugins must not call fetch directly.", pattern: /\bfetch\s*\(/g },
  { message: "Plugins must not use XMLHttpRequest.", pattern: /\bXMLHttpRequest\b/g },
  { message: "Plugins must not access process globals.", pattern: /\bprocess\b/g },
  { message: "Plugins must not import filesystem modules.", pattern: /(?:node:fs|["']fs["'])/g },
  { message: "Plugins must not import native modules.", pattern: /(?:node:http|node:https|node:child_process)/g },
  { message: "Plugins must not import packages/internal directly.", pattern: /packages\/internal|@b_be_bee\/(?:database|store|network|models|utils|logger|tracker)/g },
]

export const findPluginStaticViolations = (source: string): PluginStaticViolation[] => {
  const violations: PluginStaticViolation[] = []
  for (const rule of bannedPatterns) {
    for (const match of source.matchAll(rule.pattern)) {
      violations.push({
        index: match.index || 0,
        message: rule.message,
        pattern: rule.pattern.source,
      })
    }
  }
  return violations
}

export const assertNoPluginStaticViolations = (source: string) => {
  const violations = findPluginStaticViolations(source)
  if (violations.length > 0) {
    throw new Error(violations.map((violation) => violation.message).join("\n"))
  }
}
