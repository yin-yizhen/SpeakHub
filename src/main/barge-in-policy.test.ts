import { describe, expect, it } from 'vitest'
import { bargeInDelayMs } from './barge-in-policy'

describe('bargeInDelayMs', () => {
  it('interrupts thinking as soon as Silero confirms 250 ms of speech', () => {
    expect(bargeInDelayMs('thinking', true)).toBe(0)
  })

  it('adds 50 ms while synthesizing or speaking', () => {
    expect(bargeInDelayMs('synthesizing', true)).toBe(50)
    expect(bargeInDelayMs('speaking', true)).toBe(50)
  })

  it('adds protection when echo cancellation is unavailable', () => {
    expect(bargeInDelayMs('speaking', false)).toBe(250)
  })
})
