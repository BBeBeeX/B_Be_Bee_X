import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin, { SleepTimer } from './index.js'

class PlayerStub extends Service {
  pauseCalls = 0
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  pause() {
    this.pauseCalls++
  }
}

describe('plugin-sleep-timer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  async function harness() {
    const root = new Context()
    await root.plugin(PlayerStub)
    await root.plugin(plugin)
    await tick()
    return {
      root,
      timer: root.sleepTimer,
      player: root.player as unknown as PlayerStub,
    }
  }

  it('activates and claims its service', async () => {
    const { timer } = await harness()
    expect(timer).toBeInstanceOf(SleepTimer)
    expect(timer.state.active).toBe(false)
  })

  it('leaves nothing behind when unloaded', async () => {
    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await tick()
    const before = snapshotContext(ctx)

    const fiber = await ctx.plugin(plugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })

  it('starts duration timer and pauses player when time elapses', async () => {
    const { timer, player, root } = await harness()
    const changed = vi.fn()
    const fired = vi.fn()
    root.on('sleep-timer/changed', changed)
    root.on('sleep-timer/fired', fired)

    vi.useFakeTimers()

    timer.startDuration(15 * 60 * 1000)
    expect(timer.state.active).toBe(true)
    expect(timer.state.mode).toBe('duration')
    expect(timer.state.durationMs).toBe(15 * 60 * 1000)
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, mode: 'duration' }),
    )

    // Advance halfway
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(player.pauseCalls).toBe(0)
    expect(fired).not.toHaveBeenCalled()

    // Advance remainder
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(player.pauseCalls).toBe(1)
    expect(fired).toHaveBeenCalledOnce()
    expect(timer.state.active).toBe(false)
  })

  it('starts at epoch and pauses player when target time arrives', async () => {
    const { timer, player, root } = await harness()
    const fired = vi.fn()
    root.on('sleep-timer/fired', fired)

    vi.useFakeTimers()
    const now = Date.now()
    timer.startAtEpoch(now + 30 * 1000)
    expect(timer.state.active).toBe(true)
    expect(timer.state.mode).toBe('epoch')

    vi.advanceTimersByTime(30 * 1000)
    expect(player.pauseCalls).toBe(1)
    expect(fired).toHaveBeenCalledOnce()
  })

  it('cancels active timer without pausing', async () => {
    const { timer, player, root } = await harness()
    const changed = vi.fn()
    root.on('sleep-timer/changed', changed)

    vi.useFakeTimers()
    timer.startDuration(60 * 1000)
    expect(timer.state.active).toBe(true)

    timer.cancel()
    expect(timer.state.active).toBe(false)
    expect(changed).toHaveBeenCalledWith({ active: false })

    vi.advanceTimersByTime(120 * 1000)
    expect(player.pauseCalls).toBe(0)
  })

  it('stops player on track completion in end-of-track mode', async () => {
    const { timer, player, root } = await harness()
    const fired = vi.fn()
    root.on('sleep-timer/fired', fired)

    timer.startEndOfTrack()
    expect(timer.state.active).toBe(true)
    expect(timer.state.mode).toBe('end-of-track')

    // Simulate track completion event
    root.emit('player/track-completed', {
      id: 'play-1',
      trackUrn: 'BBeBee:test:track:1',
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      msPlayed: 1000,
      completed: true,
      skipped: false,
      deviceId: 'dev',
    })

    expect(player.pauseCalls).toBe(1)
    expect(fired).toHaveBeenCalledOnce()
    expect(timer.state.active).toBe(false)
  })

  it('stops player on status changing to idle in end-of-track mode', async () => {
    const { timer, player, root } = await harness()
    const fired = vi.fn()
    root.on('sleep-timer/fired', fired)

    timer.startEndOfTrack()
    expect(timer.state.active).toBe(true)

    // Simulate queue finish / idle state
    root.emit('player/state-changed', {
      status: 'idle',
      positionMs: 0,
      durationMs: 0,
      bufferedMs: 0,
      volume: 1,
      muted: false,
      repeat: 'off',
      shuffle: false,
      playMode: 'sequence',
    })

    expect(player.pauseCalls).toBe(1)
    expect(fired).toHaveBeenCalledOnce()
    expect(timer.state.active).toBe(false)
  })
})
