import { describe, expect, it, vi } from 'vitest'
import { StreamingAsrSession } from './streaming-asr-session'

describe('StreamingAsrSession', () => {
  it('keeps a stable message ID for mixed-language partials and finalizes on endpoint silence', () => {
    const stream = { acceptWaveform: vi.fn() }
    const results = ['你好', '你好 world']
    const recognizer = {
      isReady: vi.fn().mockReturnValue(false),
      decode: vi.fn(),
      isEndpoint: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      reset: vi.fn(),
      getResult: vi.fn(() => ({ text: results.shift() }))
    }
    const events: Array<{ utteranceId: string; text: string; final: boolean }> = []
    const session = new StreamingAsrSession(recognizer, stream, (event) => events.push(event))

    session.accept(new Float32Array([0.1]))
    session.accept(new Float32Array([0]))

    expect(events).toEqual([
      { utteranceId: 'local-asr-0', text: '你好', final: false },
      { utteranceId: 'local-asr-0', text: '你好 world', final: false },
      { utteranceId: 'local-asr-0', text: '你好 world', final: true }
    ])
    expect(stream.acceptWaveform).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 16000 }))
    expect(recognizer.reset).toHaveBeenCalledOnce()
  })

  it('does not submit an empty endpoint and starts the next turn with a new ID', () => {
    const stream = { acceptWaveform: vi.fn() }
    const results = ['', 'second turn']
    const recognizer = {
      isReady: vi.fn().mockReturnValue(false),
      decode: vi.fn(),
      isEndpoint: vi.fn().mockReturnValue(true),
      reset: vi.fn(),
      getResult: vi.fn(() => ({ text: results.shift() }))
    }
    const events: Array<{ utteranceId: string; text: string; final: boolean }> = []
    const session = new StreamingAsrSession(recognizer, stream, (event) => events.push(event))

    session.accept(new Float32Array([0]))
    session.accept(new Float32Array([0.1]))

    expect(events).toEqual([
      { utteranceId: 'local-asr-1', text: 'second turn', final: false },
      { utteranceId: 'local-asr-1', text: 'second turn', final: true }
    ])
    expect(recognizer.reset).toHaveBeenCalledTimes(2)
  })
})
