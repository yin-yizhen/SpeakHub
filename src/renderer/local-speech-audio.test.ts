import { describe, expect, it, vi } from 'vitest'
import { LocalSpeechAudioPlayer, captureChunkFrames, isPlayableSpeechGeneration, microphoneSignalLevel, microphoneSignalThreshold, microphoneToggleTones, resampleFloat32 } from './local-speech-audio'

describe('microphone toggle tones', () => {
  it('buffers cloud startup once and schedules later packets contiguously across sentences', () => {
    const starts: number[] = []
    let clock = 0
    class Context {
      get currentTime() { return clock }
      destination = {}
      resume() { return Promise.resolve() }
      close() { return Promise.resolve() }
      createBuffer(_channels: number, length: number, rate: number) { return { duration: length / rate, copyToChannel() {} } }
      createBufferSource() { return { buffer: undefined, onended: undefined, connect() {}, start(at: number) { starts.push(at) }, stop() {} } }
    }
    vi.stubGlobal('AudioContext', Context)
    try {
      const player = new LocalSpeechAudioPlayer()
      const chunk = { id: '1', messageId: 'm', index: 0, generation: 1, sampleRate: 24000 as const, format: 'float32' as const, samples: new Float32Array(4800).buffer, final: true, streaming: true }
      player.play(chunk)
      clock = 0.43
      player.play({ ...chunk, id: '2', index: 1 })
      expect(starts).toEqual([0.6, 0.8])
      player.interrupt(2)
      player.play(chunk)
      expect(starts).toHaveLength(2)
      player.stop()
    } finally { vi.unstubAllGlobals() }
  })

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

  it('distinguishes silence from a usable microphone signal', () => {
    expect(microphoneSignalLevel(new Float32Array(320))).toBe(0)
    expect(microphoneSignalLevel(Float32Array.from({ length: 320 }, (_, index) => Math.sin(index / 5) * 0.08))).toBeGreaterThan(microphoneSignalThreshold)
  })

  it('rejects audio returned by an interrupted generation', () => {
    expect(isPlayableSpeechGeneration(8, 7)).toBe(false)
    expect(isPlayableSpeechGeneration(8, 8)).toBe(true)
    expect(isPlayableSpeechGeneration(8, 9)).toBe(true)
  })
})
