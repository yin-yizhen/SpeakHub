import { describe, expect, it } from 'vitest'
import { microphoneToggleTones } from './realtime-audio'

describe('microphone toggle tones', () => {
  it('uses C-E-G when the microphone opens and G-E-C when it closes', () => {
    expect(microphoneToggleTones(true)).toEqual([261.63, 329.63, 392])
    expect(microphoneToggleTones(false)).toEqual([392, 329.63, 261.63])
  })
})
