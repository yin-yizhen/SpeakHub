import { describe, expect, it, vi } from 'vitest'
import { MicrophoneGate, shouldResetMicrophoneGateForNavigation } from './microphone-gate'

describe('shared microphone gate', () => {
  it('accepts pre-practice click/shortcut choices without touching hardware and applies them at startup', async () => {
    const gate = new MicrophoneGate()
    const apply = vi.fn(async () => undefined)
    expect(gate.state(false, 'voice', 'F8')).toMatchObject({ active: false, available: true })
    await gate.set(true, false, 'voice', apply)
    expect(gate.state(false, 'voice', 'F8').active).toBe(true)
    await gate.set(false, false, 'voice', apply)
    expect(apply).not.toHaveBeenCalled()
    gate.start('voice')
    expect(gate.active).toBe(false)
    await gate.set(true, true, 'voice', apply)
    expect(apply).toHaveBeenCalledWith(true)
    expect(gate.active).toBe(true)
    gate.end()
    expect(gate.active).toBe(false)
    gate.start('voice')
    expect(gate.active).toBe(true)
  })

  it('keeps the default voice startup enabled and does not update state after a failed hardware operation', async () => {
    const gate = new MicrophoneGate()
    gate.start('voice')
    expect(gate.active).toBe(true)
    await expect(gate.set(false, true, 'voice', async () => { throw new Error('apply failed') })).rejects.toThrow('apply failed')
    expect(gate.active).toBe(true)
    gate.end(); gate.start('text')
    expect(gate.active).toBe(false)
  })

  it('retains the installed gate across conversation SPA routes and iframe navigation', () => {
    expect(shouldResetMicrophoneGateForNavigation(true, true)).toBe(false)
    expect(shouldResetMicrophoneGateForNavigation(false, false)).toBe(false)
    expect(shouldResetMicrophoneGateForNavigation(true, false)).toBe(true)
  })
})
