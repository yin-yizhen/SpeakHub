import { describe, expect, it } from 'vitest'
import { captureChunkFrames, isPlayableSpeechGeneration, microphoneToggleTones, resampleFloat32 } from './local-speech-audio'

describe('microphone toggle tones', () => {
  it('uses C-E-G when the microphone opens and G-E-C when it closes', () => {
    expect(microphoneToggleTones(true)).toEqual([261.63, 329.63, 392])
    expect(microphoneToggleTones(false)).toEqual([392, 329.63, 261.63])
  })

  it('produces structured 16 kHz float samples without PCM quantization', () => {
    const input = Float32Array.from({ length: 480 }, (_, index) => Math.sin(index / 12))
    const output = resampleFloat32(input, 48000)
    expect(output).toHaveLength(160)
    expect(output.every((sample) => sample >= -1 && sample <= 1)).toBe(true)
    expect(output.some((sample) => sample !== Math.round(sample))).toBe(true)
  })

  it('batches native microphone frames before resampling and sending them to the main process', () => {
    const input = Float32Array.from({ length: captureChunkFrames }, (_, index) => Math.sin(index / 12))
    expect(captureChunkFrames).toBe(2048)
    expect(resampleFloat32(input, 48000)).toHaveLength(682)
  })

  it('rejects audio returned by an interrupted generation', () => {
    expect(isPlayableSpeechGeneration(8, 7)).toBe(false)
    expect(isPlayableSpeechGeneration(8, 8)).toBe(true)
    expect(isPlayableSpeechGeneration(8, 9)).toBe(true)
  })
})
