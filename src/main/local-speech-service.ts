import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'

type TranscriptListener = (event: { utteranceId: string; text: string; final: boolean }) => void
type WorkerFactory = (filename: string, options: ConstructorParameters<typeof Worker>[1]) => Pick<Worker, 'on' | 'postMessage' | 'terminate'>

export class LocalSpeechService {
  private worker?: Pick<Worker, 'on' | 'postMessage' | 'terminate'>
  private ready?: Promise<void>
  private transcriptListener?: TranscriptListener
  private errorListener?: (error: Error) => void
  private requests = new Map<string, { resolve: (audio: { samples: Float32Array; sampleRate: number }) => void; reject: (error: Error) => void }>()

  constructor(
    private readonly paths: { asr: string; tts: string },
    private readonly workerFactory: WorkerFactory = (filename, options) => new Worker(filename, options)
  ) {}

  onTranscript(listener: TranscriptListener): void { this.transcriptListener = listener }
  onError(listener: (error: Error) => void): void { this.errorListener = listener }

  start(): Promise<void> {
    if (this.ready) return this.ready
    const worker = this.workerFactory(join(__dirname, 'speech-worker.js'), { workerData: this.paths })
    this.worker = worker
    this.ready = new Promise((resolve, reject) => {
      worker.on('message', (message: unknown) => {
        const value = message as { type: string; requestId?: string; utteranceId?: string; text?: string; final?: boolean; samples?: Float32Array; sampleRate?: number; message?: string }
        if (value.type === 'ready') resolve()
        else if (value.type === 'transcript' && value.utteranceId && value.text) this.transcriptListener?.({ utteranceId: value.utteranceId, text: value.text, final: value.final === true })
        else if (value.type === 'speech' && value.requestId && value.samples && value.sampleRate) {
          this.requests.get(value.requestId)?.resolve({ samples: value.samples, sampleRate: value.sampleRate })
          this.requests.delete(value.requestId)
        } else if (value.type === 'error') {
          const error = new Error(value.message ?? 'Local speech worker failed.')
          if (value.requestId) { this.requests.get(value.requestId)?.reject(error); this.requests.delete(value.requestId) }
          else this.errorListener?.(error)
        }
      })
      worker.on('error', (error) => { reject(error); this.failAll(error) })
      worker.on('exit', (code) => {
        if (code !== 0) this.failAll(new Error(`Local speech worker exited with code ${code}.`))
      })
    })
    return this.ready
  }

  accept(samples: Float32Array): void {
    if (!this.worker) throw new Error('Local speech is not running.')
    const copy = samples.slice()
    this.worker.postMessage({ type: 'audio', samples: copy }, [copy.buffer])
  }

  async synthesize(text: string, messageId: string, index: number): Promise<{ samples: Float32Array; sampleRate: number }> {
    await this.start()
    const requestId = randomUUID()
    const result = new Promise<{ samples: Float32Array; sampleRate: number }>((resolve, reject) => this.requests.set(requestId, { resolve, reject }))
    this.worker!.postMessage({ type: 'synthesize', requestId, messageId, index, text })
    return result
  }

  reset(): void { this.worker?.postMessage({ type: 'reset' }) }

  async stop(): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    this.ready = undefined
    if (!worker) return
    worker.postMessage({ type: 'stop' })
    await worker.terminate()
    this.failAll(new Error('Local speech stopped.'))
  }

  private failAll(error: Error): void {
    for (const request of this.requests.values()) request.reject(error)
    this.requests.clear()
    this.errorListener?.(error)
  }
}
