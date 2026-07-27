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

function fakeCloud() {
  let transcriptListener: ((event: { utteranceId: string; text: string; final: boolean }) => void) | undefined
  return {
    api: {
      onTranscript: vi.fn((listener) => { transcriptListener = listener }),
      onUsage: vi.fn(),
      onError: vi.fn(),
      start: vi.fn(async () => undefined),
      accept: vi.fn(),
      stop: vi.fn(async () => undefined)
    },
    emitTranscript: (event: { utteranceId: string; text: string; final: boolean }) => transcriptListener?.(event)
  }
}

function createService(workers: FakeWorker[], cloud = fakeCloud()) {
  const filenames: string[] = []
  const service = new LocalSpeechService(
    { vad: 'D:/models/silero-vad/silero_vad.onnx', tts: 'D:/models/tts' },
    { aliyunApiKey: 'secret' },
    ((filename: string) => {
      filenames.push(filename)
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    }) as never,
    (() => cloud.api) as never
  )
  return { service, cloud, filenames }
}

async function start(service: LocalSpeechService, workers: FakeWorker[]): Promise<void> {
  const starting = service.start()
  workers[0].emit('message', { type: 'ready' })
  workers[1].emit('message', { type: 'ready' })
  await starting
}

describe('LocalSpeechService', () => {
  it('always uses VAD plus Aliyun recognition while keeping TTS in a separate worker', async () => {
    const workers: FakeWorker[] = []
    const { service, cloud, filenames } = createService(workers)
    const transcripts = vi.fn()
    const activity = vi.fn()
    service.onTranscript(transcripts)
    service.onSpeechActivity(activity)

    await start(service, workers)
    expect(filenames[0]).toMatch(/speech-vad-worker\.js$/)
    expect(filenames[1]).toMatch(/speech-tts-worker\.js$/)

    service.accept(Float32Array.from([0.1, 0.2]))
    workers[0].emit('message', { type: 'speech-started' })
    workers[0].emit('message', { type: 'audio', samples: Float32Array.from([0.2, 0.4]) })
    cloud.emitTranscript({ utteranceId: 'aliyun-1', text: '你好 English', final: true })

    expect(activity).toHaveBeenCalledWith(true)
    expect(cloud.api.accept).toHaveBeenCalledWith(Float32Array.from([0.2, 0.4]))
    expect(transcripts).toHaveBeenCalledWith({ utteranceId: 'aliyun-1', text: '你好 English', final: true })
    expect(workers[0].messages).toHaveLength(1)
  })

  it('keeps VAD audio flowing while Kokoro synthesizes', async () => {
    const workers: FakeWorker[] = []
    const { service } = createService(workers)
    await start(service, workers)

    const speech = service.synthesize('Hello', 'message-1', 0, 4)
    await Promise.resolve()
    const request = workers[1].messages[0] as { requestId: string }
    service.accept(Float32Array.from([0.3, 0.4]))
    workers[1].emit('message', { type: 'speech', requestId: request.requestId, generation: 4, samples: Float32Array.from([0.5]), sampleRate: 24000 })

    await expect(speech).resolves.toMatchObject({ sampleRate: 24000 })
    expect(workers[0].messages).toHaveLength(1)
  })

  it('rejects stale synthesis immediately when a generation is interrupted', async () => {
    const workers: FakeWorker[] = []
    const { service } = createService(workers)
    await start(service, workers)

    const speech = service.synthesize('Old reply', 'message-1', 0, 7)
    await Promise.resolve()
    service.cancelSynthesis(7)

    await expect(speech).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[1].messages).toContainEqual({ type: 'cancel', generation: 7 })
  })

  it('requires an Aliyun API key before recognition starts', async () => {
    const workers: FakeWorker[] = []
    const service = new LocalSpeechService(
      { vad: 'D:/models/silero-vad/silero_vad.onnx', tts: 'D:/models/tts' },
      {},
      ((_filename: string) => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      }) as never
    )

    const starting = service.start()
    workers[0].emit('message', { type: 'ready' })
    workers[1].emit('message', { type: 'ready' })
    await expect(starting).rejects.toThrow('DashScope API Key')
  })
})
