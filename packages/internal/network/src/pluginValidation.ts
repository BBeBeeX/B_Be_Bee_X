export interface PluginHttpViolation {
  index: number
  pattern: string
  message: string
}

const BANNED_HTTP_PATTERNS = [
  {
    message: "Plugins must use the plugin-scoped network client instead of fetch.",
    pattern: /\bfetch\s*\(/g,
  },
  {
    message: "Plugins must use the plugin-scoped network client instead of XMLHttpRequest.",
    pattern: /\bXMLHttpRequest\b/g,
  },
  {
    message: "Plugins must not import Node http directly.",
    pattern: /(?:from\s+["']node:http["']|from\s+["']http["']|require\(\s*["'](?:node:)?http["']\s*\))/g,
  },
  {
    message: "Plugins must not import Node https directly.",
    pattern: /(?:from\s+["']node:https["']|from\s+["']https["']|require\(\s*["'](?:node:)?https["']\s*\))/g,
  },
  {
    message: "Plugins must not use unapproved HTTP client libraries directly.",
    pattern: /(?:from\s+["'](?:axios|got|ky|superagent)["']|require\(\s*["'](?:axios|got|ky|superagent)["']\s*\))/g,
  },
]

export const findPluginHttpViolations = (source: string): PluginHttpViolation[] => {
  const violations: PluginHttpViolation[] = []
  for (const rule of BANNED_HTTP_PATTERNS) {
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

export const assertNoPluginHttpViolations = (source: string) => {
  const violations = findPluginHttpViolations(source)
  if (violations.length > 0) {
    throw new Error(violations.map((violation) => violation.message).join("\n"))
  }
}
