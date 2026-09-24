import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { WasapiInitConfig, WasapiInitResult } from './types.js'

const execAsync = promisify(exec)

export interface SystemAudioDevice {
  id: string
  label: string
  isDefault: boolean
}

export class WasapiEngine {
  private activeConfig?: WasapiInitConfig
  private isRunning = false
  private totalFramesWritten = 0
  private selectedDeviceId = 'default'

  async isSupported(): Promise<boolean> {
    return process.platform === 'win32'
  }

  async init(config: WasapiInitConfig): Promise<WasapiInitResult> {
    this.activeConfig = config
    this.isRunning = true
    this.totalFramesWritten = 0

    const bufferMs = config.bufferMs || 50
    const bufferSizeFrames = Math.round((config.sampleRate * bufferMs) / 1000)

    return {
      ok: true,
      bufferSizeFrames,
      actualSampleRate: config.sampleRate,
      actualBitDepth: config.bitDepth || 24,
    }
  }

  async write(pcmChunk: Float32Array): Promise<number> {
    if (!this.isRunning || !this.activeConfig) return 0

    const channels = this.activeConfig.channels || 2
    const frames = Math.floor(pcmChunk.length / channels)
    this.totalFramesWritten += frames

    return frames
  }

  async stop(): Promise<void> {
    this.isRunning = false
    this.activeConfig = undefined
  }

  async getOutputDevices(): Promise<SystemAudioDevice[]> {
    const defaultLabel =
      process.platform === 'win32'
        ? '系统默认音频终端 (WASAPI Exclusive)'
        : '系统默认音频输出 (System Default)'

    const results: SystemAudioDevice[] = [
      { id: 'default', label: defaultLabel, isDefault: true },
    ]

    let systemDevices: SystemAudioDevice[] = []
    if (process.platform === 'win32') {
      systemDevices = await this.queryWindowsDevices()
    } else if (process.platform === 'darwin') {
      systemDevices = await this.queryDarwinDevices()
    } else if (process.platform === 'linux') {
      systemDevices = await this.queryLinuxDevices()
    }

    for (const dev of systemDevices) {
      if (!results.some((r) => r.id === dev.id || r.label === dev.label)) {
        results.push(dev)
      }
    }

    return results
  }

  async setOutputDevice(id: string): Promise<void> {
    this.selectedDeviceId = id
  }

  private async queryWindowsDevices(): Promise<SystemAudioDevice[]> {
    const devices: SystemAudioDevice[] = []
    try {
      const script = `
        $reg = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render';
        if (Test-Path $reg) {
          Get-ChildItem $reg | ForEach-Object {
            $val = Get-ItemProperty $_.PsPath;
            if ($val.DeviceState -eq 1) {
              $name = (Get-ItemProperty "$($_.PsPath)\\Properties").'{a45c254e-df1c-4efd-8020-67d146a850e0},2';
              if ($name) {
                [PSCustomObject]@{ id = $_.PSChildName; label = $name }
              }
            }
          } | ConvertTo-Json -Compress
        }
      `.replace(/\s+/g, ' ').trim()

      const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
        timeout: 3000,
        windowsHide: true,
      })

      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim())
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          if (item?.id && item?.label) {
            devices.push({
              id: String(item.id),
              label: String(item.label),
              isDefault: false,
            })
          }
        }
      }
    } catch {
      try {
        const { stdout } = await execAsync(
          'powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_SoundDevice | Select-Object -Property DeviceID, Name | ConvertTo-Json -Compress"',
          { timeout: 3000, windowsHide: true },
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
        }
      } catch {
        // ignore
      }
    }
    return devices
  }

  private async queryLinuxDevices(): Promise<SystemAudioDevice[]> {
    const devices: SystemAudioDevice[] = []
    try {
      const { stdout } = await execAsync('pactl -f json list sinks', { timeout: 2000 })
      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim())
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          const label = item?.description || item?.name
          if (label) {
            devices.push({
              id: String(item.name || item.index),
              label: String(label),
              isDefault: false,
            })
          }
        }
      }
    } catch {
      try {
        const { stdout } = await execAsync('aplay -l', { timeout: 2000 })
        const matches = stdout.matchAll(/card\s+(\d+):\s*([^,]+),\s*device\s+(\d+):\s*([^\n]+)/gi)
        for (const m of matches) {
          devices.push({
            id: `hw:${m[1]},${m[3]}`,
            label: `${m[2]?.trim()} (${m[4]?.trim()})`,
            isDefault: false,
          })
        }
      } catch {
        // ignore
      }
    }
    return devices
  }

  private async queryDarwinDevices(): Promise<SystemAudioDevice[]> {
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
      }
    } catch {
      // ignore
    }
    return devices
  }
}
