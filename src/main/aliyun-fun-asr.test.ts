import { describe, expect, it, vi } from 'vitest'
import { AliyunFunAsr, ALIYUN_FUN_ASR_MODEL, float32ToPcm16, isSupportedBilingualTranscript } from './aliyun-fun-asr'

class FakeSocket {
  readonly sent: Array<string | Buffer> = []
  readonly listeners = new Map<string, Array<(value?: unknown) => void>>()
  readyState = 1
  on(event: string, listener: (value?: unknown) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }
  send(value: string | Buffer): void { this.sent.push(value) }
  close(): void { this.emit('close') }
  emit(event: string, value?: unknown): void { for (const listener of this.listeners.get(event) ?? []) listener(value) }
}

describe('AliyunFunAsr', () => {
  it('starts the fixed bilingual low-semantic task and streams stable partial/final transcripts', async () => {
    const socket = new FakeSocket()
    const factory = vi.fn(() => socket)
    const service = new AliyunFunAsr('secret', factory as never)
    const transcripts = vi.fn()
    const usage = vi.fn()
    service.onTranscript(transcripts)
    service.onUsage(usage)

    const starting = service.start()
    socket.emit('open')
    const start = JSON.parse(socket.sent[0] as string)
    expect(start.payload).toMatchObject({
      model: ALIYUN_FUN_ASR_MODEL,
      input: {},
      parameters: { format: 'pcm', sample_rate: 16000, semantic_punctuation_enabled: false, max_sentence_silence: 700, heartbeat: true }
    })
    expect(start.payload.parameters).not.toHaveProperty('language_hints')
    socket.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started' }, payload: {} })))
    await starting

    socket.emit('message', Buffer.from(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 3, text: '你好 broken English', sentence_end: false, heartbeat: false } }, usage: null } })))
    socket.emit('message', Buffer.from(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 3, text: '你好 broken English', sentence_end: true, heartbeat: false } }, usage: { duration: 4 } } })))

    expect(transcripts).toHaveBeenNthCalledWith(1, expect.objectContaining({ utteranceId: expect.stringMatching(/-3$/), text: '你好 broken English', final: false }))
    expect(transcripts).toHaveBeenNthCalledWith(2, expect.objectContaining({ utteranceId: expect.stringMatching(/-3$/), text: '你好 broken English', final: true }))
    expect(usage).toHaveBeenCalledWith(4)
  })

  it('buffers audio until ready, sends PCM16, and rejects Japanese or Korean script', async () => {
    const socket = new FakeSocket()
    const service = new AliyunFunAsr('secret', (() => socket) as never)
    const transcripts = vi.fn()
    const errors = vi.fn()
    service.onTranscript(transcripts)
    service.onError(errors)
    service.accept(Float32Array.from([-1, 0, 1]))
    socket.emit('open')
    socket.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started' }, payload: {} })))
    await Promise.resolve()

    const audio = socket.sent.find((value) => Buffer.isBuffer(value)) as Buffer
    expect([...audio]).toEqual([...float32ToPcm16(Float32Array.from([-1, 0, 1]))])
    socket.emit('message', Buffer.from(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 1, text: 'これはテスト', sentence_end: true } }, usage: { duration: 2 } } })))
    expect(transcripts).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('已拦截') }))
    expect(isSupportedBilingualTranscript('I no understand 这个')).toBe(true)
    expect(isSupportedBilingualTranscript('오케이')).toBe(false)
  })

  it('reconnects on the next speech and keeps usage cumulative across tasks', async () => {
    const sockets = [new FakeSocket(), new FakeSocket()]
    const factory = vi.fn(() => sockets.shift()!)
    const service = new AliyunFunAsr('secret', factory as never)
    const usage = vi.fn()
    service.onUsage(usage)
    service.onError(() => undefined)

    const first = service.start()
    const socket1 = factory.mock.results[0].value as FakeSocket
    socket1.emit('open')
    socket1.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started' } })))
    await first
    socket1.emit('message', Buffer.from(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 1, text: 'first', sentence_end: true } }, usage: { duration: 4 } } })))
    socket1.emit('close')

    service.accept(Float32Array.from([0.1]))
    const socket2 = factory.mock.results[1].value as FakeSocket
    socket2.emit('open')
    socket2.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started' } })))
    await Promise.resolve()
    socket2.emit('message', Buffer.from(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 1, text: 'second', sentence_end: true } }, usage: { duration: 2 } } })))

    expect(usage.mock.calls.map(([seconds]) => seconds)).toEqual([4, 6])
  })
})
