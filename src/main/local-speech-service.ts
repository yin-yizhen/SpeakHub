import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'

type TranscriptListener = (event: { utteranceId: string; text: string; final: boolean }) => void
type SpeechActivityListener = (active: boolean) => void
type WorkerHandle = Pick<Worker, 'on' | 'postMessage' | 'terminate'>
type WorkerFactory = (filename: string, options: ConstructorParameters<typeof Worker>[1]) => WorkerHandle
type SpeechRequest = {
  generation: number
  resolve: (audio: { samples: Float32Array; sampleRate: number }) => void
  reject: (error: Error) => void
}

function aborted(): Error {
  const error = new Error('Speech synthesis was interrupted.')
  error.name = 'AbortError'
  return error
}

export class LocalSpeechService {
  private asrWorker?: WorkerHandle
  private ttsWorker?: WorkerHandle
  private ready?: Promise<void>
  private transcriptListener?: TranscriptListener
  private speechActivityListener?: SpeechActivityListener
  private errorListener?: (error: Error) => void
  private requests = new Map<string, SpeechRequest>()

  constructor(
    private readonly paths: { asr: string; tts: string },
    private readonly workerFactory: WorkerFactory = (filename, options) => new Worker(filename, options)
  ) {}

  onTranscript(listener: TranscriptListener): void { this.transcriptListener = listener }
  onSpeechActivity(listener: SpeechActivityListener): void { this.speechActivityListener = listener }
  onError(listener: (error: Error) => void): void { this.errorListener = listener }

  start(): Promise<void> {
    if (this.ready) return this.ready
    const asrWorker = this.workerFactory(join(__dirname, 'speech-asr-worker.js'), { workerData: { asr: this.paths.asr } })
    const ttsWorker = this.workerFactory(join(__dirname, 'speech-tts-worker.js'), { workerData: { tts: this.paths.tts } })
    this.asrWorker = asrWorker
    this.ttsWorker = ttsWorker
    this.ready = Promise.all([
      this.waitUntilReady(asrWorker, 'ASR', (message) => this.handleAsrMessage(message)),
      this.waitUntilReady(ttsWorker, 'TTS', (message) => this.handleTtsMessage(message))
    ]).then(() => undefined)
    return this.ready
  }

  accept(samples: Float32Array): void {
    if (!this.asrWorker) throw new Error('Local speech recognition is not running.')
    const copy = samples.slice()
    this.asrWorker.postMessage({ type: 'audio', samples: copy }, [copy.buffer])
  }

  async synthesize(text: string, messageId: string, index: number, generation: number): Promise<{ samples: Float32Array; sampleRate: number }> {
    await this.start()
    const requestId = randomUUID()
    const result = new Promise<{ samples: Float32Array; sampleRate: number }>((resolve, reject) => this.requests.set(requestId, { generation, resolve, reject }))
    this.ttsWorker!.postMessage({ type: 'synthesize', requestId, messageId, index, generation, text })
    return result
  }

  cancelSynthesis(generation: number): void {
    this.ttsWorker?.postMessage({ type: 'cancel', generation })
    for (const [requestId, request] of this.requests) {
      if (request.generation > generation) continue
      request.reject(aborted())
      this.requests.delete(requestId)
    }
  }

  reset(): void { this.asrWorker?.postMessage({ type: 'reset' }) }

  async stop(): Promise<void> {
    const workers = [this.asrWorker, this.ttsWorker].filter((worker): worker is WorkerHandle => Boolean(worker))
    this.asrWorker = undefined
    this.ttsWorker = undefined
    this.ready = undefined
    for (const worker of workers) worker.postMessage({ type: 'stop' })
    await Promise.all(workers.map((worker) => worker.terminate()))
    this.failAll(new Error('Local speech stopped.'))
  }

  private waitUntilReady(worker: WorkerHandle, label: string, onMessage: (message: unknown) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      worker.on('message', (message: unknown) => {
        const value = message as { type?: string }
        if (value.type === 'ready') resolve()
        else onMessage(message)
      })
      worker.on('error', (error) => { reject(error); this.failAll(error) })
      worker.on('exit', (code) => {
        if (code !== 0) {
          const error = new Error(`${label} worker exited with code ${code}.`)
          reject(error)
          this.failAll(error)
        }
      })
    })
  }

  private handleAsrMessage(message: unknown): void {
    const value = message as { type?: string; utteranceId?: string; text?: string; final?: boolean; message?: string }
    if (value.type === 'transcript' && value.utteranceId && value.text) {
      this.transcriptListener?.({ utteranceId: value.utteranceId, text: value.text, final: value.final === true })
    } else if (value.type === 'speech-started') {
      this.speechActivityListener?.(true)
    } else if (value.type === 'speech-stopped') {
      this.speechActivityListener?.(false)
    } else if (value.type === 'error') {
      this.errorListener?.(new Error(value.message ?? 'Local speech recognition failed.'))
    }
  }

  private handleTtsMessage(message: unknown): void {
    const value = message as { type?: string; requestId?: string; generation?: number; samples?: Float32Array; sampleRate?: number; message?: string }
    if (value.type === 'speech' && value.requestId && value.samples && value.sampleRate) {
      const request = this.requests.get(value.requestId)
      if (request && request.generation === value.generation) request.resolve({ samples: value.samples, sampleRate: value.sampleRate })
      this.requests.delete(value.requestId)
    } else if (value.type === 'error') {
      const error = new Error(value.message ?? 'Local speech synthesis failed.')
      if (value.requestId) {
        this.requests.get(value.requestId)?.reject(error)
        this.requests.delete(value.requestId)
      } else {
        this.errorListener?.(error)
      }
    }
  }

  private failAll(error: Error): void {
    for (const request of this.requests.values()) request.reject(error)
    this.requests.clear()
    this.errorListener?.(error)
  }
}
