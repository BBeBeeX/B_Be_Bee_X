import type { LoggerBackend } from "./electron"

export class ConsoleLoggerBackend implements LoggerBackend {
  initialize(): void {}

  log(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.log(...args)
  }

  info(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.info(...args)
  }

  warn(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.warn(...args)
  }

  error(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.error(...args)
  }

  debug(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.debug(...args)
  }
}
