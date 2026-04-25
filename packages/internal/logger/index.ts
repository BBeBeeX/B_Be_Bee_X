import {
  ElectronLoggerBackend,
  isElectronLogLike,
  type ElectronLogLike,
  type LoggerBackend,
} from "./electron"
import { ConsoleLoggerBackend } from "./web"

export interface Logger {
  initialize: () => Promise<void>
  log: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

const isElectronRuntime = () => {
  const globalProcess = (globalThis as { process?: unknown }).process
  if (typeof globalProcess !== "object" || globalProcess === null) {
    return false
  }

  const versions = "versions" in globalProcess ? globalProcess.versions : undefined
  if (typeof versions !== "object" || versions === null) {
    return false
  }

  return typeof (versions as { electron?: unknown }).electron === "string"
}

const loadElectronModule = async (): Promise<ElectronLogLike | undefined> => {
  if (!isElectronRuntime()) {
    return undefined
  }

  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<unknown>
    const loadedModule = await dynamicImport("electron-log")

    if (isElectronLogLike(loadedModule)) {
      return loadedModule
    }

    if (
      typeof loadedModule === "object" &&
      loadedModule !== null &&
      "default" in loadedModule &&
      isElectronLogLike(loadedModule.default)
    ) {
      return loadedModule.default
    }
  } catch {
    return undefined
  }

  return undefined
}

class AdaptiveLogger implements Logger {
  private backend: LoggerBackend = new ConsoleLoggerBackend()
  private initializationPromise?: Promise<void>

  constructor() {
    if (isElectronRuntime()) {
      void this.initialize()
    }
  }

  async initialize(): Promise<void> {
    if (!isElectronRuntime()) {
      return
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeBackend()
    }

    await this.initializationPromise
  }

  log(...args: unknown[]): void {
    this.backend.log(...args)
  }

  info(...args: unknown[]): void {
    this.backend.info(...args)
  }

  warn(...args: unknown[]): void {
    this.backend.warn(...args)
  }

  error(...args: unknown[]): void {
    this.backend.error(...args)
  }

  debug(...args: unknown[]): void {
    this.backend.debug(...args)
  }

  private async initializeBackend(): Promise<void> {
    const electronModule = await loadElectronModule()
    if (!electronModule) {
      return
    }

    const electronBackend = new ElectronLoggerBackend(electronModule)
    electronBackend.initialize()
    this.backend = electronBackend
  }
}

export const logger = new AdaptiveLogger()

export const initialize = () => logger.initialize()
export const log = (...args: unknown[]) => logger.log(...args)
export const info = (...args: unknown[]) => logger.info(...args)
export const warn = (...args: unknown[]) => logger.warn(...args)
export const error = (...args: unknown[]) => logger.error(...args)
export const debug = (...args: unknown[]) => logger.debug(...args)

export default logger
