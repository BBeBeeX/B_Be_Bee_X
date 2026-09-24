import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
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
    let systemDevices: SystemAudioDevice[] = []
    if (process.platform === 'win32') {
      systemDevices = await this.queryWindowsDevices()
    } else if (process.platform === 'darwin') {
      systemDevices = await this.queryDarwinDevices()
    } else if (process.platform === 'linux') {
      systemDevices = await this.queryLinuxDevices()
    }

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
      }
    }

    if (results.length === 0) {
      results.push({ id: 'default', label: '音频输出设备', isDefault: true, isVirtual: false })
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

      const { stdout } = await execAsync(
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
      }
    } catch {
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
        }
      } catch {
        // ignore
      }
    }
    return devices
  }

  private async queryLinuxDevices(): Promise<SystemAudioDevice[]> {
    const devices: SystemAudioDevice[] = []
    let defaultSink = ''
    try {
      const { stdout: defOut } = await execAsync('pactl get-default-sink', {
        timeout: 1000,
        env: { ...process.env, LC_ALL: 'C.UTF-8' },
      })
      defaultSink = defOut.trim()
    } catch {
      // ignore
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
        if (devices.length > 0) return devices
      }
    } catch {
      // ignore pactl failure and try aplay fallback
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
    } catch {
      // ignore
    }

    if (devices.length === 0) {
      const procDevices = this.queryLinuxAlsaProc()
      if (procDevices.length > 0) {
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
