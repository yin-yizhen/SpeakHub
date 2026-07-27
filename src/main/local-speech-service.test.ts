import { describe, expect, it, vi } from 'vitest'
import { LocalSpeechService } from './local-speech-service'

class FakeWorker {
  readonly messages: unknown[] = []
  private listeners = new Map<string, Array<(...args: never[]) => void>>()

  on(event: string, listener: (...args: never[]) => void): this {
    const current = this.listeners.get(event) ?? []
    current.push(listener)
    this.listeners.set(event, current)
    return this
  }

  postMessage(message: unknown): void { this.messages.push(message) }
  terminate = vi.fn(async () => 0)
  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never)
  }
}

describe('LocalSpeechService', () => {
  it('runs ASR and TTS in separate workers and keeps audio flowing during synthesis', async () => {
    const workers: FakeWorker[] = []
    const service = new LocalSpeechService(
      { asr: 'D:/models/asr', tts: 'D:/models/tts' },
      ((_filename: string) => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      }) as never
    )
    const transcripts = vi.fn()
    const activity = vi.fn()
    service.onTranscript(transcripts)
    service.onSpeechActivity(activity)

    const starting = service.start()
    expect(workers).toHaveLength(2)
    workers[0].emit('message', { type: 'ready' })
    workers[1].emit('message', { type: 'ready' })
    await starting

    service.accept(Float32Array.from([0.1, 0.2]))
    expect(workers[0].messages).toHaveLength(1)
    expect(workers[1].messages).toHaveLength(0)

    const speech = service.synthesize('Hello', 'message-1', 0, 4)
    await Promise.resolve()
    const request = workers[1].messages[0] as { requestId: string }
    service.accept(Float32Array.from([0.3, 0.4]))
    workers[0].emit('message', { type: 'speech-started' })
    workers[0].emit('message', { type: 'transcript', utteranceId: 'local-asr-0', text: 'hello', final: false })
    workers[1].emit('message', { type: 'speech', requestId: request.requestId, generation: 4, samples: Float32Array.from([0.5]), sampleRate: 24000 })

    await expect(speech).resolves.toMatchObject({ sampleRate: 24000 })
    expect(workers[0].messages).toHaveLength(2)
    expect(activity).toHaveBeenCalledWith(true)
    expect(transcripts).toHaveBeenCalledWith({ utteranceId: 'local-asr-0', text: 'hello', final: false })
  })

  it('rejects stale synthesis immediately when a generation is interrupted', async () => {
    const workers: FakeWorker[] = []
    const service = new LocalSpeechService(
      { asr: 'D:/models/asr', tts: 'D:/models/tts' },
      ((_filename: string) => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      }) as never
    )
    const starting = service.start()
    workers[0].emit('message', { type: 'ready' })
    workers[1].emit('message', { type: 'ready' })
    await starting

    const speech = service.synthesize('Old reply', 'message-1', 0, 7)
    await Promise.resolve()
    service.cancelSynthesis(7)

    await expect(speech).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[1].messages).toContainEqual({ type: 'cancel', generation: 7 })
  })
})
