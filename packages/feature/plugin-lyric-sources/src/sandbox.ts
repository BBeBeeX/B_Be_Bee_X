import type { HttpService, JsService, LyricSearchQuery, LyricSourceDefinition } from '@BBeBee/protocol'

/**
 * Checks whether an outbound target URL is allowed by the source's allowedHosts.
 */
export function checkAllowedHost(urlStr: string, allowedHosts?: string[]): void {
  if (!allowedHosts || allowedHosts.length === 0) return
  let hostname: string
  try {
    const url = new URL(urlStr)
    hostname = url.hostname.toLowerCase()
  } catch {
    throw new Error(`Invalid URL for httpFetch: "${urlStr}"`)
  }

  const isAllowed = allowedHosts.some((pattern) => {
    const target = pattern.toLowerCase().trim()
    return hostname === target || hostname.endsWith(`.${target}`)
  })

  if (!isAllowed) {
    throw new Error(
      `Outbound HTTP request to host "${hostname}" is blocked: not in allowedHosts (${allowedHosts.join(', ')})`,
    )
  }
}

/**
 * Safe fetch bridge exposed to the sandbox.
 */
export async function safeHttpFetch(
  url: string,
  options?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
  },
  httpService?: HttpService,
  allowedHosts?: string[],
): Promise<{
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
  body: string
}> {
  checkAllowedHost(url, allowedHosts)

  const timeoutMs = options?.timeoutMs ?? 8000

  if (httpService) {
    const method = (options?.method?.toUpperCase() ?? 'GET') as
      | 'GET'
      | 'POST'
      | 'PUT'
      | 'DELETE'
      | 'HEAD'
      | 'PATCH'
    const resp = await httpService({
      url,
      method,
      headers: options?.headers,
      body: options?.body,
      timeoutMs,
    })
    const textData = await resp.text()
    return {
      status: resp.status,
      text: async () => textData,
      json: async () => {
        try {
          return JSON.parse(textData)
        } catch {
          return null
        }
      },
      body: textData,
    }
  }

  // Fallback to global web fetch
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: options?.headers,
    body: options?.body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const textData = await res.text()
  return {
    status: res.status,
    text: async () => textData,
    json: async () => {
      try {
        return JSON.parse(textData)
      } catch {
        return null
      }
    },
    body: textData,
  }
}

export interface SandboxServices {
  js?: JsService
  http?: HttpService
}

/**
 * Executes a third-party lyric source script within an isolated sandbox.
 * Strictly limits input to only `{ title, artist, duration }`.
 */
export async function executeLyricSource(
  source: LyricSourceDefinition,
  rawQuery: LyricSearchQuery,
  services: SandboxServices = {},
): Promise<unknown> {
  // Enforce strict data boundary: ONLY title, artist, and duration are passed
  const sanitizedQuery = Object.freeze({
    title: String(rawQuery.title ?? ''),
    artist: String(rawQuery.artist ?? ''),
    duration: Math.round(Number(rawQuery.duration ?? 0)),
  })

  // 1. If QuickJS realm service (ctx.js) is available, use real engine realm
  if (services.js) {
    const realm = await services.js.createRealm({
      timeoutMs: 4000,
      budgetMs: 12000,
      memoryBytes: 16 * 1024 * 1024,
    })

    try {
      realm.expose('httpFetch', async (urlArg: unknown, optionsArg?: unknown) => {
        const url = String(urlArg ?? '')
        const options =
          optionsArg && typeof optionsArg === 'object'
            ? (optionsArg as Record<string, unknown>)
            : {}
        const result = await safeHttpFetch(
          url,
          {
            method: typeof options.method === 'string' ? options.method : undefined,
            headers:
              typeof options.headers === 'object' && options.headers !== null
                ? (options.headers as Record<string, string>)
                : undefined,
            body: typeof options.body === 'string' ? options.body : undefined,
            timeoutMs: typeof options.timeoutMs === 'number' ? options.timeoutMs : undefined,
          },
          services.http,
          source.allowedHosts,
        )
        return {
          status: result.status,
          body: result.body,
        }
      })

      // Script runner wrapper
      const runner = `
      (async () => {
        ${source.script}
        if (typeof searchLyrics === 'function') {
          return await searchLyrics(__query__);
        }
        if (typeof main === 'function') {
          return await main(__query__);
        }
        if (typeof getLyrics === 'function') {
          return await getLyrics(__query__);
        }
        return null;
      })()
      `

      return await realm.eval(runner, { __query__: sanitizedQuery })
    } finally {
      realm.dispose()
    }
  }

  // 2. Fallback execution when ctx.js is not present (e.g. testing or environments without native QuickJS)
  const boundHttpFetch = async (url: string, options?: Parameters<typeof safeHttpFetch>[1]) => {
    const res = await safeHttpFetch(url, options, services.http, source.allowedHosts)
    return {
      status: res.status,
      text: res.text,
      json: res.json,
      body: res.body,
    }
  }

  // Strictly shadow dangerous host variables
  const wrappedFunction = new Function(
    '__query__',
    'httpFetch',
    'window',
    'document',
    'process',
    'require',
    'global',
    'globalThis',
    `"use strict";
     ${source.script}
     if (typeof searchLyrics === 'function') return searchLyrics(__query__);
     if (typeof main === 'function') return main(__query__);
     if (typeof getLyrics === 'function') return getLyrics(__query__);
     return null;`,
  )

  const executionPromise = Promise.resolve().then(() =>
    wrappedFunction(
      sanitizedQuery,
      boundHttpFetch,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ),
  )

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Lyric source execution timed out after 10000ms')), 10000),
  )

  return await Promise.race([executionPromise, timeoutPromise])
}
