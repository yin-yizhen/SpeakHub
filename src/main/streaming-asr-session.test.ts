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

  it('buffers the utterance and emits only the Whisper-corrected final text', async () => {
    const stream = { acceptWaveform: vi.fn() }
    const recognizer = {
      isReady: vi.fn().mockReturnValue(false),
      decode: vi.fn(),
      isEndpoint: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      reset: vi.fn(),
      getResult: vi.fn().mockReturnValueOnce({ text: '嗯' }).mockReturnValueOnce({ text: '嗯来自' })
    }
    const events: Array<{ utteranceId: string; text: string; final: boolean }> = []
    const finalize = vi.fn(async () => 'Where are you from?')
    const session = new StreamingAsrSession(recognizer, stream, (event) => events.push(event), finalize)

    session.accept(new Float32Array([0.1, 0.2]))
    session.accept(new Float32Array([0.3]))
    expect(events).toEqual([
      { utteranceId: 'local-asr-0', text: '嗯', final: false },
      { utteranceId: 'local-asr-0', text: '嗯来自', final: false }
    ])

    await vi.waitFor(() => expect(events.at(-1)).toEqual({ utteranceId: 'local-asr-0', text: 'Where are you from?', final: true }))
    expect(finalize).toHaveBeenCalledWith(Float32Array.from([0.1, 0.2, 0.3]), '嗯来自')
  })

  it('starts recognizing the next utterance while Whisper is still correcting the previous one', async () => {
    const stream = { acceptWaveform: vi.fn() }
    const recognizer = {
      isReady: vi.fn().mockReturnValue(false),
      decode: vi.fn(),
      isEndpoint: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
      reset: vi.fn(),
      getResult: vi.fn().mockReturnValueOnce({ text: 'first' }).mockReturnValueOnce({ text: 'second' })
    }
    let finishCorrection: ((text: string) => void) | undefined
    const finalize = vi.fn(() => new Promise<string>((resolve) => { finishCorrection = resolve }))
    const events: Array<{ utteranceId: string; text: string; final: boolean }> = []
    const session = new StreamingAsrSession(recognizer, stream, (event) => events.push(event), finalize)

    session.accept(Float32Array.from([0.1]))
    session.accept(Float32Array.from([0.2]))

    expect(events).toContainEqual({ utteranceId: 'local-asr-1', text: 'second', final: false })
    expect(stream.acceptWaveform).toHaveBeenCalledTimes(2)
    finishCorrection?.('First corrected')
    await vi.waitFor(() => expect(events).toContainEqual({ utteranceId: 'local-asr-0', text: 'First corrected', final: true }))
  })
})
