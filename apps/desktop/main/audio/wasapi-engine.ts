import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
import { wasapiNative } from '@BBeBee/core-audio-wasapi-native'
import type { WasapiInitConfig, WasapiInitResult } from './types.js'

const execAsync = promisify(exec)

export interface SystemAudioDevice {
  id: string
  label: string
  isDefault: boolean
  isVirtual?: boolean
}

export function cleanAndTagDeviceLabel(
  rawLabel: string,
  id?: string,
  isVirtualHint?: boolean,
): { label: string; isVirtual: boolean } {
  let label = (rawLabel || '')
    .replace(/^(默认\s*[-–:：]\s*|Default\s*[-–:：]\s*|系统默认\s*[-–:：]\s*)/i, '')
    .replace(/\s*\((System Default|默认)\)$/i, '')
    .trim()

  if (
    label === '系统默认音频设备 (System Default)' ||
    label === '系统默认音频设备' ||
    label === '系统默认音频终端 (WASAPI Exclusive)' ||
    label === '默认音频终端 (WASAPI Exclusive)' ||
    label === '系统默认音频输出 (System Default)'
  ) {
    label = ''
  }

  const isVirtual = Boolean(
    isVirtualHint ||
      /voicemeeter|vb-audio|vbaudio|virtual|虚拟|todesk|steam streaming|sonar|null sink|null-sink|null_sink|loopback|blackhole|soundflower|obs|easyeffects|pulseeffects|scream|discord/i.test(
        `${label} ${id || ''}`,
      ),
  )

  label = label.replace(/\s*(\(虚拟\)|\[虚拟\])\s*$/g, '').trim()
  if (isVirtual && label && !label.endsWith('(虚拟)')) {
    label = `${label} (虚拟)`
  }

  return { label, isVirtual }
}

export interface AudioMainLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug?(message: string, ...args: unknown[]): void
}

export class WasapiEngine {
  private activeConfig?: WasapiInitConfig
  private isRunning = false
  private totalFramesWritten = 0
  private lastThroughputLogAt = 0
  private framesSinceLastLog = 0
  private selectedDeviceId = 'default'

  constructor(private logger?: AudioMainLogger) {}

  private logInfo(msg: string, ...args: unknown[]): void {
    if (this.logger?.info) {
      this.logger.info(msg, ...args)
    } else {
      process.stdout.write(`[desktop:audio] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`)
    }
  }

  private logWarn(msg: string, ...args: unknown[]): void {
    if (this.logger?.warn) {
      this.logger.warn(msg, ...args)
    } else {
      process.stdout.write(`[desktop:audio:WARN] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`)
    }
  }

  private logError(msg: string, ...args: unknown[]): void {
    if (this.logger?.error) {
      this.logger.error(msg, ...args)
    } else {
      process.stderr.write(`[desktop:audio:ERROR] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`)
    }
  }

  private logDebug(msg: string, ...args: unknown[]): void {
    if (this.logger?.debug) {
      this.logger.debug(msg, ...args)
    }
  }

  async isSupported(): Promise<boolean> {
    return process.platform === 'win32' && wasapiNative.isSupported()
  }

  async init(config: WasapiInitConfig): Promise<WasapiInitResult> {
    this.logInfo('init() called with config:', config)
    this.activeConfig = config
    this.isRunning = true
    this.totalFramesWritten = 0
    this.lastThroughputLogAt = Date.now()
    this.framesSinceLastLog = 0

    if (wasapiNative.isSupported()) {
      const targetDevId = this.selectedDeviceId === 'default' ? undefined : this.selectedDeviceId
      const nativeRes = wasapiNative.init({
        deviceId: targetDevId,
        sampleRate: config.sampleRate,
        channels: config.channels,
        bitDepth: config.bitDepth || 24,
        bufferMs: config.bufferMs || 50,
      })

      if (!nativeRes.ok) {
        this.logWarn('wasapiNative.init failed: %s', nativeRes.error)
        this.isRunning = false
        return {
          ok: false,
          error: nativeRes.error,
        }
      }

      return {
        ok: true,
        bufferSizeFrames: nativeRes.bufferSizeFrames,
        actualSampleRate: nativeRes.actualSampleRate ?? config.sampleRate,
        actualBitDepth: nativeRes.actualBitDepth ?? (config.bitDepth || 24),
      }
    }

    this.logWarn('init() called but WASAPI native driver is not available on this platform/build')
    this.isRunning = false
    return {
      ok: false,
      error: 'WASAPI native driver unavailable',
    }
  }

  async write(pcmChunk: Float32Array): Promise<number> {
    if (!this.isRunning || !this.activeConfig) return 0

    const channels = this.activeConfig.channels || 2
    const frames = Math.floor(pcmChunk.length / channels)
    this.totalFramesWritten += frames
    this.framesSinceLastLog += frames

    if (wasapiNative.isSupported()) {
      wasapiNative.write(pcmChunk)
    }

    const now = Date.now()
    const elapsed = now - this.lastThroughputLogAt
    if (elapsed >= 2000) {
      const fps = Math.round((this.framesSinceLastLog * 1000) / elapsed)
      const kbps = ((fps * channels * 4) / 1024).toFixed(1)
      this.logInfo(
        `writeWasapi throughput: ${fps} frames/sec (~${kbps} KB/s, chunk=${pcmChunk.length} samples, totalFrames=${this.totalFramesWritten})`,
      )
      this.lastThroughputLogAt = now
      this.framesSinceLastLog = 0
    }

    return frames
  }

  async stop(): Promise<void> {
    this.logInfo('stop() called in WasapiEngine')
    this.isRunning = false
    this.activeConfig = undefined
    if (wasapiNative.isSupported()) {
      wasapiNative.stop()
    }
  }

  async getOutputDevices(): Promise<SystemAudioDevice[]> {
    this.logInfo(`getOutputDevices() query started for platform="${process.platform}"`)
    let systemDevices: SystemAudioDevice[] = []
    if (process.platform === 'win32') {
      if (wasapiNative.isSupported()) {
        const nativeDevs = wasapiNative.getDevices()
        if (nativeDevs.length > 0) {
          this.logInfo(`getOutputDevices: IMMDeviceEnumerator returned ${nativeDevs.length} devices`)
          systemDevices = nativeDevs
        }
      }
      if (systemDevices.length === 0) {
        systemDevices = await this.queryWindowsDevices()
      }
    } else if (process.platform === 'darwin') {
      systemDevices = await this.queryDarwinDevices()
    } else if (process.platform === 'linux') {
      systemDevices = await this.queryLinuxDevices()
    } else {
      this.logWarn(`unsupported platform "${process.platform}" for getOutputDevices`)
    }
    this.logInfo(`raw platform devices discovered (${systemDevices.length}):`, systemDevices)

    const results: SystemAudioDevice[] = []
    for (const dev of systemDevices) {
      const { label, isVirtual } = cleanAndTagDeviceLabel(dev.label, dev.id, dev.isVirtual)
      if (!results.some((r) => r.id === dev.id || r.label === label)) {
        results.push({
          id: dev.id,
          label,
          isDefault: dev.isDefault,
          isVirtual,
        })
      } else {
        this.logDebug(`skipping duplicate device id="${dev.id}", label="${label}"`)
      }
    }

    if (results.length === 0) {
      this.logWarn('no system audio devices discovered; returning default fallback device')
      results.push({ id: 'default', label: '音频输出设备', isDefault: true, isVirtual: false })
    } else {
      this.logInfo(`getOutputDevices returning ${results.length} processed devices:`, results)
    }

    return results
  }

  async setOutputDevice(id: string): Promise<void> {
    this.logInfo(`setOutputDevice("${id}") invoked in WasapiEngine`)
    this.selectedDeviceId = id
  }

  private async queryWindowsDevices(): Promise<SystemAudioDevice[]> {
    this.logInfo('queryWindowsDevices: executing PowerShell MMDevices/PnP script...')
    const devices: SystemAudioDevice[] = []
    try {
      const script = `
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
        [Console]::InputEncoding = [System.Text.Encoding]::UTF8;
        $results = @();
        $reg = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render';
        if (Test-Path $reg) {
          Get-ChildItem $reg -ErrorAction SilentlyContinue | ForEach-Object {
            $state = (Get-ItemProperty $_.PsPath -Name DeviceState -ErrorAction SilentlyContinue).DeviceState;
            if ($state -eq 1) {
              $propPath = Join-Path $_.PsPath 'Properties';
              if (Test-Path $propPath) {
                $props = Get-ItemProperty $propPath -ErrorAction SilentlyContinue;
                $name = $props.'{a45c254e-df1c-4efd-8020-67d146a850e0},2';
                if (-not $name) {
                  $name = $props.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6';
                }
                if (-not $name) {
                  $name = $props.'{a45c254e-df1c-4efd-8020-67d146a850e0},14';
                }
                if ($name) {
                  $results += [PSCustomObject]@{
                    Id = $_.PSChildName;
                    FriendlyName = [string]$name;
                  }
                }
              }
            }
          }
        }
        if ($results.Count -eq 0) {
          $pnp = Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction SilentlyContinue;
          if ($pnp) {
            $pnp | ForEach-Object {
              if ($_.FriendlyName) {
                $results += [PSCustomObject]@{
                  Id = $_.InstanceId;
                  FriendlyName = [string]$_.FriendlyName;
                }
              }
            }
          }
        }
        if ($results.Count -gt 0) {
          $results | ConvertTo-Json -Compress
        }
      `.replace(/\s+/g, ' ').trim()

      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script}"`,
        {
          timeout: 4000,
          windowsHide: true,
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            LC_ALL: 'C.UTF-8',
          },
          maxBuffer: 1024 * 1024 * 4,
        },
      )

      if (stderr && stderr.trim()) {
        this.logWarn('queryWindowsDevices: powershell stderr:', stderr.trim())
      }
      this.logDebug(`queryWindowsDevices: powershell stdout length=${stdout?.length ?? 0}`)

      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim())
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          const label = item?.FriendlyName || item?.Name
          const id = item?.InstanceId || item?.DeviceID || label
          if (label && id) {
            devices.push({
              id: String(id),
              label: String(label),
              isDefault: false,
            })
          }
        }
        this.logInfo(`queryWindowsDevices: parsed ${devices.length} devices from MMDevices/PnP`)
      } else {
        this.logWarn('queryWindowsDevices: MMDevices/PnP script returned empty stdout')
      }
    } catch (err) {
      this.logWarn(`queryWindowsDevices: MMDevices/PnP script failed (${String(err)}), falling back to Win32_SoundDevice...`)
      // fallback to Win32_SoundDevice if PnP failed
      try {
        const { stdout } = await execAsync(
          'powershell -NoProfile -NonInteractive -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_SoundDevice | Select-Object -Property DeviceID, Name | ConvertTo-Json -Compress"',
          {
            timeout: 3000,
            windowsHide: true,
            encoding: 'utf8',
            env: { ...process.env, LC_ALL: 'C.UTF-8' },
          },
        )
        if (stdout && stdout.trim()) {
          const parsed = JSON.parse(stdout.trim())
          const items = Array.isArray(parsed) ? parsed : [parsed]
          for (const item of items) {
            if (item?.Name) {
              devices.push({
                id: String(item.DeviceID || item.Name),
                label: String(item.Name),
                isDefault: false,
              })
            }
          }
          this.logInfo(`queryWindowsDevices: Win32_SoundDevice fallback parsed ${devices.length} devices`)
        }
      } catch (fallbackErr) {
        this.logError(`queryWindowsDevices: Win32_SoundDevice fallback also failed: ${String(fallbackErr)}`)
      }
    }
    return devices
  }

  private async queryLinuxDevices(): Promise<SystemAudioDevice[]> {
    this.logInfo('queryLinuxDevices: querying Linux audio devices (pactl / aplay / /proc/asound)...')
    const devices: SystemAudioDevice[] = []
    let defaultSink = ''
    try {
      const { stdout: defOut } = await execAsync('pactl get-default-sink', {
        timeout: 1000,
        env: { ...process.env, LC_ALL: 'C.UTF-8' },
      })
      defaultSink = defOut.trim()
      this.logDebug(`queryLinuxDevices: pactl default sink="${defaultSink}"`)
    } catch (err) {
      this.logDebug(`queryLinuxDevices: pactl get-default-sink failed: ${String(err)}`)
    }

    try {
      const { stdout } = await execAsync('pactl -f json list sinks', {
        timeout: 2500,
        env: { ...process.env, LC_ALL: 'C.UTF-8' },
      })
      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim())
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          const props = item?.properties || {}
          const label =
            item?.description ||
            props['device.description'] ||
            props['device.nick'] ||
            props['node.description'] ||
            item?.name
          const id = String(item.name || item.index)
          if (label) {
            devices.push({
              id,
              label: String(label),
              isDefault: id === defaultSink,
            })
          }
        }
        if (devices.length > 0) {
          this.logInfo(`queryLinuxDevices: parsed ${devices.length} devices from pactl sinks`)
          return devices
        }
      }
    } catch (err) {
      this.logWarn(`queryLinuxDevices: pactl -f json list sinks failed (${String(err)}), falling back to aplay -l`)
    }

    try {
      const { stdout } = await execAsync('aplay -l', {
        timeout: 2000,
        env: { ...process.env, LC_ALL: 'C.UTF-8' },
      })
      const matches = stdout.matchAll(/card\s+(\d+):\s*([^,]+),\s*device\s+(\d+):\s*([^\n]+)/gi)
      for (const m of matches) {
        devices.push({
          id: `hw:${m[1]},${m[3]}`,
          label: `${m[2]?.trim()} (${m[4]?.trim()})`,
          isDefault: false,
        })
      }
      if (devices.length > 0) {
        this.logInfo(`queryLinuxDevices: parsed ${devices.length} devices from aplay -l`)
      }
    } catch (err) {
      this.logWarn(`queryLinuxDevices: aplay -l failed: ${String(err)}`)
    }

    if (devices.length === 0) {
      this.logInfo('queryLinuxDevices: trying /proc/asound fallback...')
      const procDevices = this.queryLinuxAlsaProc()
      if (procDevices.length > 0) {
        this.logInfo(`queryLinuxDevices: found ${procDevices.length} devices from /proc/asound`)
        return procDevices
      }
    }

    return devices
  }

  private queryLinuxAlsaProc(): SystemAudioDevice[] {
    const devices: SystemAudioDevice[] = []
    if (!existsSync('/proc/asound/cards')) return devices

    try {
      const cardsContent = readFileSync('/proc/asound/cards', 'utf8')
      const cardRegex = /^\s*(\d+)\s+\[([^\]]+)\]:\s*([^\n]+)(?:\n\s+([^\n]+))?/gm
      const cards = new Map<string, { shortName: string; friendly: string; line2: string }>()
      let m: RegExpExecArray | null
      while ((m = cardRegex.exec(cardsContent)) !== null) {
        const cardId = String(parseInt(m[1]!, 10))
        const shortName = m[2]!.trim()
        const line1 = m[3]!.trim()
        const line2 = m[4] ? m[4].trim() : ''
        let friendly = line1
        if (line1.includes(' - ')) {
          friendly = line1.split(' - ').slice(1).join(' - ').trim()
        }
        cards.set(cardId, { shortName, friendly, line2 })
      }

      if (existsSync('/proc/asound/pcm')) {
        const pcmContent = readFileSync('/proc/asound/pcm', 'utf8')
        const pcmLines = pcmContent.split('\n')
        for (const line of pcmLines) {
          const match = /^(\d+)-(\d+):\s*([^:]+)\s*:\s*([^:]+)\s*:(.*)$/.exec(line.trim())
          if (match) {
            const cardNum = String(parseInt(match[1]!, 10))
            const devNum = String(parseInt(match[2]!, 10))
            const subName = match[4]!.trim()
            const modes = match[5]
            if (modes && modes.includes('playback')) {
              const cardInfo = cards.get(cardNum)
              const baseName = cardInfo?.friendly || `声卡 ${cardNum}`
              const isVirtual = /loopback|dummy|virtual|null/i.test(`${baseName} ${subName} ${cardInfo?.shortName || ''}`)
              const label = subName && subName !== baseName ? `${baseName} (${subName})` : baseName
              devices.push({
                id: `hw:${cardNum},${devNum}`,
                label: isVirtual ? `${label} (虚拟)` : label,
                isDefault: cardNum === '0' && devNum === '0',
                isVirtual,
              })
            }
          }
        }
      }

      if (devices.length === 0) {
        for (const [cardNum, cardInfo] of cards.entries()) {
          const isVirtual = /loopback|dummy|virtual|null/i.test(`${cardInfo.friendly} ${cardInfo.shortName}`)
          devices.push({
            id: `hw:${cardNum},0`,
            label: isVirtual ? `${cardInfo.friendly} (虚拟)` : cardInfo.friendly,
            isDefault: cardNum === '0',
            isVirtual,
          })
        }
      }
    } catch {
      // ignore
    }

    return devices
  }

  private async queryDarwinDevices(): Promise<SystemAudioDevice[]> {
    this.logInfo('queryDarwinDevices: querying macOS audio devices via system_profiler...')
    const devices: SystemAudioDevice[] = []
    try {
      const { stdout } = await execAsync('system_profiler SPAudioDataType -json', { timeout: 2500 })
      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim())
        const items = (parsed?.SPAudioDataType?.[0]?._items as Array<{
          _name?: string
          coreaudio_device_id?: string
          coreaudio_output_streams?: unknown
          coreaudio_device_transport?: unknown
          coreaudio_default_audio_output_device?: unknown
        }>) || []
        for (const item of items) {
          const name = item?._name
          if (name && (item.coreaudio_output_streams || item.coreaudio_device_transport)) {
            devices.push({
              id: String(item.coreaudio_device_id || name),
              label: String(name),
              isDefault: Boolean(item.coreaudio_default_audio_output_device),
            })
          }
        }
        this.logInfo(`queryDarwinDevices: parsed ${devices.length} devices from system_profiler`)
      }
    } catch (err) {
      this.logError(`queryDarwinDevices: system_profiler query failed: ${String(err)}`)
    }
    return devices
  }
}
