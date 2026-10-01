/**
 * Audio Engine Supervisor.
 *
 * Runs in Electron Main process. Spawns, monitors, and isolates the native
 * audio-engine standalone binary process. If the child process crashes, the supervisor
 * isolates the failure from the Main and Renderer processes, notifies listeners,
 * and recovers gracefully.
 */

import { fork, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AudioMainLogger } from './audio-devices.js'
import type { DspConfig } from './audio-engine-worker.js'

export interface FftFrame {
  frequencyData: number[]
  timeDomainData: number[]
}

export interface PlaybackStateEvent {
  status: 'idle' | 'playing' | 'paused' | 'stopped' | 'stalled'
  positionMs: number
  durationMs: number
}

export interface CrashEvent {
  code: number | null
  signal: string | null
  restarting: boolean
}

export class AudioEngineSupervisor {
  private child: ChildProcess | null = null
  private readonly logger?: AudioMainLogger
  private readonly customExecutablePath?: string
  private isShuttingDown = false
  private restartCount = 0
  private lastRestartTime = 0

  private readonly fftListeners = new Set<(frame: FftFrame) => void>()
  private readonly stateListeners = new Set<(event: PlaybackStateEvent) => void>()
  private readonly endedListeners = new Set<() => void>()
  private readonly crashListeners = new Set<(event: CrashEvent) => void>()
  private readonly readyListeners = new Set<() => void>()

  private currentUri?: string
  private currentVolume = 0.8
  private currentMuted = false
  private currentDeviceId = 'default'
  private currentDspConfig?: DspConfig
  private visualizerEnabled = true
  private currentFftSize = 128

  constructor(logger?: AudioMainLogger, customExecutablePath?: string) {
    this.logger = logger
    this.customExecutablePath = customExecutablePath
  }

  start(): void {
    if (this.child) return
    this.spawnWorker()
  }

  resolveExecutablePath(): string | null {
    if (this.customExecutablePath && existsSync(this.customExecutablePath)) {
      return this.customExecutablePath
    }
    const envPath = process.env['AUDIO_ENGINE_PATH']
    if (envPath && existsSync(envPath)) {
      return envPath
    }

    const isWin = process.platform === 'win32'
    const exeName = isWin ? 'audio-engine.exe' : 'audio-engine'

    // Packaged application resources path
    const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath
    if (resourcesPath) {
      const packagedExe = join(resourcesPath, 'bin', exeName)
      if (existsSync(packagedExe)) return packagedExe
    }

    // Development paths
    try {
      const currentDir = dirname(fileURLToPath(import.meta.url))
      const candidatePaths = [
        join(currentDir, '..', '..', 'bin', exeName),
        join(currentDir, '..', '..', '..', 'bin', exeName),
        join(process.cwd(), 'apps', 'desktop', 'bin', exeName),
        join(process.cwd(), 'bin', exeName),
      ]

      for (const p of candidatePaths) {
        if (existsSync(p)) return p
      }
    } catch {
      // In bundled environments without fileURLToPath resolution
    }

    return null
  }

  private spawnWorker(): void {
    try {
      const exePath = this.resolveExecutablePath()

      if (exePath) {
        this.logger?.info?.('audio-engine-supervisor: spawning standalone native audio-engine executable at: %s', exePath)

        this.child = spawn(exePath, [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' },
        })

        let stdoutBuffer = ''
        this.child.stdout?.on('data', (chunk: Buffer | string) => {
          stdoutBuffer += chunk.toString()
          const lines = stdoutBuffer.split('\n')
          stdoutBuffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed) {
              try {
                const msg = JSON.parse(trimmed)
                this.handleWorkerMessage(msg)
              } catch {
                this.logger?.debug?.('audio-engine-supervisor: unparseable stdout line: %s', trimmed)
              }
            }
          }
        })

        this.child.stderr?.on('data', (chunk: Buffer | string) => {
          const text = chunk.toString().trim()
          if (text) {
            this.logger?.debug?.('audio-engine [stderr]: %s', text)
          }
        })
      } else {
        const currentDir = dirname(fileURLToPath(import.meta.url))
        const workerScript = join(currentDir, 'audio-engine-worker.js')
        this.logger?.warn?.('audio-engine-supervisor: native executable not found, falling back to worker script: %s', workerScript)

        this.child = fork(workerScript, [], {
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' },
        })

        this.child.on('message', (msg: unknown) => {
          this.handleWorkerMessage(msg)
        })
      }

      this.child.on('error', (err) => {
        this.logger?.error?.('audio-engine-supervisor: worker process error: %s', String(err))
      })

      this.child.on('exit', (code, signal) => {
        this.handleWorkerExit(code, signal)
      })

      // Send initial configuration to worker
      this.sendCommand({
        action: 'init',
        config: {
          deviceId: this.currentDeviceId,
          fftSize: this.currentFftSize,
        },
      })

      // Restore parameters if reconnecting
      if (this.currentVolume !== 0.8) this.setVolume(this.currentVolume)
      if (this.currentMuted) this.setMuted(this.currentMuted)
      if (this.currentDspConfig) this.setDspConfig(this.currentDspConfig)
    } catch (err) {
      this.logger?.error?.('audio-engine-supervisor: failed to spawn worker: %s', String(err))
    }
  }

  private handleWorkerMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return
    const payload = msg as Record<string, unknown>
    const type = payload['type']

    switch (type) {
      case 'ready':
        for (const cb of this.readyListeners) cb()
        break
      case 'state':
      case 'playback-state':
        for (const cb of this.stateListeners) {
          cb({
            status: payload['status'] as PlaybackStateEvent['status'],
            positionMs: Number(payload['positionMs'] ?? 0),
            durationMs: Number(payload['durationMs'] ?? 0),
          })
        }
        break
      case 'ended':
        for (const cb of this.endedListeners) cb()
        break
      case 'fftFrame':
      case 'fft-frame':
        for (const cb of this.fftListeners) {
          cb({
            frequencyData: (payload['frequencyData'] as number[]) ?? [],
            timeDomainData: (payload['timeDomainData'] as number[]) ?? [],
          })
        }
        break
      case 'heartbeat':
        break
    }
  }

  private handleWorkerExit(code: number | null, signal: string | null): void {
    this.child = null
    if (this.isShuttingDown) return

    const now = Date.now()
    if (now - this.lastRestartTime > 10_000) {
      this.restartCount = 0
    }
    this.lastRestartTime = now
    this.restartCount++

    const shouldRestart = this.restartCount <= 5
    this.logger?.warn?.(
      'audio-engine-supervisor: worker process terminated unexpectedly (code: %s, signal: %s). Restarting: %s',
      code,
      signal,
      shouldRestart,
    )

    // Notify listeners of crash isolation event
    for (const cb of this.crashListeners) {
      cb({ code, signal, restarting: shouldRestart })
    }

    if (shouldRestart) {
      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.spawnWorker()
          // If a track was playing, re-load state
          if (this.currentUri) {
            this.load(this.currentUri)
          }
        }
      }, 500)
    }
  }

  load(uri: string, options?: { headers?: Record<string, string>; strategy?: string }): void {
    this.currentUri = uri
    this.sendCommand({ action: 'load', uri, options })
  }

  play(atMs?: number): void {
    this.sendCommand({ action: 'play', atMs })
  }

  pause(): void {
    this.sendCommand({ action: 'pause' })
  }

  stop(): void {
    this.sendCommand({ action: 'stop' })
  }

  seek(positionMs: number): void {
    this.sendCommand({ action: 'seek', positionMs })
  }

  setVolume(volume: number): void {
    this.currentVolume = volume
    this.sendCommand({ action: 'setVolume', volume })
  }

  setMuted(muted: boolean): void {
    this.currentMuted = muted
    this.sendCommand({ action: 'setMuted', muted })
  }

  setOutputDevice(deviceId: string): void {
    this.currentDeviceId = deviceId
    this.sendCommand({ action: 'setOutputDevice', deviceId })
  }

  setDspConfig(config: DspConfig): void {
    this.currentDspConfig = config
    this.sendCommand({ action: 'setDspConfig', config })
  }

  setVisualizer(enabled: boolean, fftSize?: number): void {
    this.visualizerEnabled = enabled
    if (fftSize) this.currentFftSize = fftSize
    this.sendCommand({ action: 'setVisualizer', enabled, fftSize })
  }

  private sendCommand(cmd: Record<string, unknown>): void {
    if (!this.child || this.child.killed) return

    if (this.child.stdin?.writable) {
      this.child.stdin.write(JSON.stringify(cmd) + '\n')
    } else if (this.child.connected) {
      this.child.send(cmd)
    }
  }

  onFftFrame(cb: (frame: FftFrame) => void): () => void {
    this.fftListeners.add(cb)
    return () => this.fftListeners.delete(cb)
  }

  onStateChange(cb: (event: PlaybackStateEvent) => void): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb)
    return () => this.endedListeners.delete(cb)
  }

  onCrash(cb: (event: CrashEvent) => void): () => void {
    this.crashListeners.add(cb)
    return () => this.crashListeners.delete(cb)
  }

  onReady(cb: () => void): () => void {
    this.readyListeners.add(cb)
    return () => this.readyListeners.delete(cb)
  }

  dispose(): void {
    this.isShuttingDown = true
    if (this.child) {
      this.sendCommand({ action: 'dispose' })
      const proc = this.child
      this.child = null
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL')
        }
      }, 500)
    }
    this.fftListeners.clear()
    this.stateListeners.clear()
    this.endedListeners.clear()
    this.crashListeners.clear()
    this.readyListeners.clear()
  }
}
