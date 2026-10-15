import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AliyunAsr, ALIYUN_ASR_MODEL, ALIYUN_ASR_CNY_PER_SECOND, float32ToPcm16, isSupportedBilingualTranscript } from './aliyun-asr'

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

describe('AliyunAsr', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
  it('starts the bilingual Paraformer VAD task and streams stable partial/final transcripts', async () => {
    const socket = new FakeSocket()
    const factory = vi.fn(() => socket)
    const service = new AliyunAsr('secret', factory as never)
    const transcripts = vi.fn()
    const usage = vi.fn()
    service.onTranscript(transcripts)
    service.onUsage(usage)

    const starting = service.start()
    socket.emit('open')
    const start = JSON.parse(socket.sent[0] as string)
    expect(start.payload).toMatchObject({
      model: 'paraformer-realtime-v2',
      input: {},
      parameters: { format: 'pcm', sample_rate: 16000, semantic_punctuation_enabled: false, max_sentence_silence: 1100, heartbeat: true }
    })
    expect(start.payload.parameters).toMatchObject({ language_hints: ['en'], disfluency_removal_enabled: false })
    expect(ALIYUN_ASR_MODEL).toBe('paraformer-realtime-v2')
    expect(ALIYUN_ASR_CNY_PER_SECOND * 3600).toBeCloseTo(0.864)
    socket.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started' }, payload: {} })))
    await starting

    socket.emit('message', Buffer.from(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 3, text: '你好 broken English', sentence_end: false, heartbeat: false } }, usage: null } })))
    socket.emit('message', Buffer.from(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 3, text: '你好 broken English', sentence_end: true, heartbeat: false } }, usage: { duration: 4 } } })))

    expect(transcripts).toHaveBeenNthCalledWith(1, expect.objectContaining({ utteranceId: expect.stringMatching(/-3$/), text: '你好 broken English', final: false }))
    expect(transcripts).toHaveBeenNthCalledWith(2, expect.objectContaining({ utteranceId: expect.stringMatching(/-3$/), text: '你好 broken English', final: true }))
    expect(usage).toHaveBeenCalledWith(4)
  })

  it('leaves language detection automatic for mixed Chinese and English practice', async () => {
    const socket = new FakeSocket()
    const service = new AliyunAsr('secret', (() => socket) as never, 'auto')
    const starting = service.start()
    socket.emit('open')
    expect(JSON.parse(socket.sent[0] as string).payload.parameters).not.toHaveProperty('language_hints')
    socket.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    await starting
    await service.stop()
  })

  it('buffers audio until ready, sends PCM16, and rejects Japanese or Korean script', async () => {
    const socket = new FakeSocket()
    const service = new AliyunAsr('secret', (() => socket) as never)
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

  it('reconnects without waiting for speech and keeps usage cumulative across tasks', async () => {
    const sockets = [new FakeSocket(), new FakeSocket()]
    const factory = vi.fn(() => sockets.shift()!)
    const service = new AliyunAsr('secret', factory as never)
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
    await vi.advanceTimersByTimeAsync(1_000)

    service.accept(Float32Array.from([0.1]))
    const socket2 = factory.mock.results[1].value as FakeSocket
    socket2.emit('open')
    socket2.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-started' } })))
    await Promise.resolve()
    socket2.emit('message', Buffer.from(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 1, text: 'second', sentence_end: true } }, usage: { duration: 2 } } })))

    expect(usage.mock.calls.map(([seconds]) => seconds)).toEqual([4, 6])
  })

  it('supplies PCM silence for over eight seconds without capture and stops all traffic on stop', async () => {
    const socket = new FakeSocket()
    const service = new AliyunAsr('secret', (() => socket) as never)
    const transcripts = vi.fn()
    service.onTranscript(transcripts)
    const starting = service.start()
    socket.emit('open')
    socket.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    await starting
    await vi.advanceTimersByTimeAsync(12_000)
    const silence = socket.sent.filter(Buffer.isBuffer)
    expect(silence).toHaveLength(60)
    expect(silence.every((chunk) => chunk.length === 6_400 && chunk.every((byte) => byte === 0))).toBe(true)
    socket.emit('message', Buffer.from('{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"heartbeat":true,"text":"ignored"}}}}'))
    expect(transcripts).not.toHaveBeenCalled()
    await service.stop()
    const sent = socket.sent.length
    await vi.advanceTimersByTimeAsync(20_000)
    service.accept(new Float32Array(3_200))
    expect(socket.sent).toHaveLength(sent)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not inject silence while real microphone chunks are flowing', async () => {
    const socket = new FakeSocket()
    const service = new AliyunAsr('secret', (() => socket) as never)
    const starting = service.start()
    socket.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    await starting
    for (let index = 0; index < 100; index += 1) {
      service.accept(Float32Array.from([0.5]))
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(socket.sent.filter(Buffer.isBuffer)).toHaveLength(100)
    await service.stop()
  })

  it('replaces a failed task even without a server close and ignores its late events', async () => {
    const first = new FakeSocket()
    first.close = vi.fn() // server never completes the close handshake
    const second = new FakeSocket()
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValue(second)
    const service = new AliyunAsr('secret', factory)
    const transcripts = vi.fn()
    const errors = vi.fn()
    service.onTranscript(transcripts)
    service.onError(errors)
    const starting = service.start()
    first.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    await starting
    first.emit('message', Buffer.from('{"header":{"event":"task-failed","error_message":"request timeout after 23 seconds."}}'))
    service.accept(Float32Array.from([0.25]))
    expect(factory).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    second.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    first.emit('close')
    first.emit('error', new Error('late error'))
    first.emit('message', Buffer.from('{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"text":"stale","sentence_end":true}}}}'))
    second.emit('message', Buffer.from('{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"sentence_id":1,"text":"Recovered speech","sentence_end":false}}}}'))
    second.emit('message', Buffer.from('{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"sentence_id":1,"text":"Recovered speech","sentence_end":true}}}}'))
    expect(second.sent.filter(Buffer.isBuffer)[0]).toEqual(float32ToPcm16(Float32Array.from([0.25])))
    expect(transcripts.mock.calls.map(([event]) => [event.text, event.final])).toEqual([['Recovered speech', false], ['Recovered speech', true]])
    expect(transcripts.mock.calls[0][0].utteranceId).toBe(transcripts.mock.calls[1][0].utteranceId)
    expect(errors).toHaveBeenCalledTimes(1)
    await service.stop()
  })

  it('rejects an early close, permits retry, and settles startup when stopped', async () => {
    const first = new FakeSocket()
    const second = new FakeSocket()
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValue(second)
    const service = new AliyunAsr('secret', factory)
    const starting = service.start()
    const rejected = expect(starting).rejects.toThrow('断开')
    first.emit('close')
    await rejected
    const retry = service.start()
    const cancelled = expect(retry).rejects.toThrow('停止')
    await service.stop()
    await cancelled
    first.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    second.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('backs off failed reconnects despite incoming audio and cancels retries on stop', async () => {
    const sockets: FakeSocket[] = []
    const factory = vi.fn(() => { const socket = new FakeSocket(); sockets.push(socket); return socket })
    const service = new AliyunAsr('secret', factory as never)
    const starting = service.start()
    sockets[0].emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    await starting
    sockets[0].emit('error', new Error('offline'))
    await vi.advanceTimersByTimeAsync(1_000)
    sockets[1].emit('error', new Error('offline'))
    for (let index = 0; index < 19; index += 1) {
      service.accept(new Float32Array(1_600))
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(factory).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(factory).toHaveBeenCalledTimes(3)
    sockets[2].emit('error', new Error('offline'))
    await service.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(factory).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears timed-out handshakes even when the socket never closes', async () => {
    const socket = new FakeSocket()
    socket.close = vi.fn()
    const factory = vi.fn(() => socket)
    const service = new AliyunAsr('secret', factory as never)
    const starting = service.start()
    const failed = expect(starting).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(5_000)
    await failed
    expect(socket.close).toHaveBeenCalledOnce()
    const retry = service.start()
    socket.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    await retry
    expect(factory).toHaveBeenCalledTimes(2)
    await service.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers from audio send failures and still cleans up if finish-task cannot be sent', async () => {
    const first = new FakeSocket()
    const second = new FakeSocket()
    const service = new AliyunAsr('secret', vi.fn().mockReturnValueOnce(first).mockReturnValue(second))
    const starting = service.start()
    first.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    await starting
    first.send = () => { throw new Error('send failed') }
    expect(() => service.accept(Float32Array.from([0.1]))).not.toThrow()
    await vi.advanceTimersByTimeAsync(1_000)
    second.emit('message', Buffer.from('{"header":{"event":"task-started"}}'))
    second.send = () => { throw new Error('finish failed') }
    await expect(service.stop()).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
