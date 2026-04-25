export interface ElectronLogLike {
  initialize?: () => void
  log: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export interface LoggerBackend {
  initialize: () => Promise<void> | void
  log: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export class ElectronLoggerBackend implements LoggerBackend {
  constructor(private readonly electronLog: ElectronLogLike) {}

  initialize(): void {
    this.electronLog.initialize?.()
  }

  log(...args: unknown[]): void {
    this.electronLog.log(...args)
  }

  info(...args: unknown[]): void {
    this.electronLog.info(...args)
  }

  warn(...args: unknown[]): void {
    this.electronLog.warn(...args)
  }

  error(...args: unknown[]): void {
    this.electronLog.error(...args)
  }

  debug(...args: unknown[]): void {
    this.electronLog.debug(...args)
  }
}

export const isElectronLogLike = (value: unknown): value is ElectronLogLike => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const candidate = value as Partial<ElectronLogLike>
  return (
    typeof candidate.log === "function" &&
    typeof candidate.info === "function" &&
    typeof candidate.warn === "function" &&
    typeof candidate.error === "function" &&
    typeof candidate.debug === "function"
  )
}
