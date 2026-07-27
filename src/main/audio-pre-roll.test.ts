import { describe, expect, it } from 'vitest'
import { AudioPreRoll } from './audio-pre-roll'

describe('AudioPreRoll', () => {
  it('keeps exactly the latest 400 ms of 16 kHz audio without dropping the leading speech', () => {
    const buffer = new AudioPreRoll(6_400)
    buffer.push(Float32Array.from({ length: 4_000 }, (_, index) => index))
    buffer.push(Float32Array.from({ length: 4_000 }, (_, index) => index + 4_000))

    const samples = Float32Array.from(buffer.drain().flatMap((chunk) => [...chunk]))
    expect(samples).toHaveLength(6_400)
    expect(samples[0]).toBe(1_600)
    expect(samples.at(-1)).toBe(7_999)
  })
})
