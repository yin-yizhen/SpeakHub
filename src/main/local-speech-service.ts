import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { AliyunFunAsr } from './aliyun-fun-asr'

type TranscriptListener = (event: { utteranceId: string; text: string; final: boolean }) => void
type SpeechActivityListener = (active: boolean) => void
type WorkerHandle = Pick<Worker, 'on' | 'postMessage' | 'unref'>
type WorkerFactory = (filename: string, options: ConstructorParameters<typeof Worker>[1]) => WorkerHandle
type CloudRecognizer = Pick<AliyunFunAsr, 'onTranscript' | 'onUsage' | 'onError' | 'start' | 'accept' | 'stop'>
type CloudFactory = (apiKey: string) => CloudRecognizer
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
  private vadWorker?: WorkerHandle
  private ttsWorker?: WorkerHandle
  private ready?: Promise<void>
  private transcriptListener?: TranscriptListener
  private speechActivityListener?: SpeechActivityListener
  private errorListener?: (error: Error) => void
  private usageListener?: (cumulativeSeconds: number) => void
  private requests = new Map<string, SpeechRequest>()
  private cloudRecognizer?: CloudRecognizer

  constructor(
    private readonly paths: { vad: string; tts: string },
    private readonly options: { aliyunApiKey?: string } = {},
    private readonly workerFactory: WorkerFactory = (filename, options) => new Worker(filename, options),
    private readonly cloudFactory: CloudFactory = (apiKey) => new AliyunFunAsr(apiKey)
  ) {}

  onTranscript(listener: TranscriptListener): void { this.transcriptListener = listener }
  onSpeechActivity(listener: SpeechActivityListener): void { this.speechActivityListener = listener }
  onError(listener: (error: Error) => void): void { this.errorListener = listener }
  onUsage(listener: (cumulativeSeconds: number) => void): void { this.usageListener = listener }

  start(): Promise<void> {
    if (this.ready) return this.ready
    const vadWorker = this.workerFactory(join(__dirname, 'speech-vad-worker.js'), { workerData: { vad: this.paths.vad } })
    const ttsWorker = this.workerFactory(join(__dirname, 'speech-tts-worker.js'), { workerData: { tts: this.paths.tts } })
    this.vadWorker = vadWorker
    this.ttsWorker = ttsWorker
    this.ready = Promise.all([
      this.waitUntilReady(vadWorker, 'VAD', (message) => this.handleVadMessage(message)),
      this.waitUntilReady(ttsWorker, 'TTS', (message) => this.handleTtsMessage(message)),
      this.startCloudRecognizer()
    ]).then(() => undefined)
    return this.ready
  }

  accept(samples: Float32Array): void {
    if (!this.vadWorker) throw new Error('Voice activity detection is not running.')
    const copy = samples.slice()
    this.vadWorker.postMessage({ type: 'audio', samples: copy }, [copy.buffer])
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

  reset(): void { this.vadWorker?.postMessage({ type: 'reset' }) }

  async stop(): Promise<void> {
    const workers = [this.vadWorker, this.ttsWorker].filter((worker): worker is WorkerHandle => Boolean(worker))
    const cloudRecognizer = this.cloudRecognizer
    this.vadWorker = undefined
    this.ttsWorker = undefined
    this.ready = undefined
    this.cloudRecognizer = undefined
    this.rejectAll(aborted())
    await Promise.all([
      cloudRecognizer?.stop(),
      ...workers.map((worker) => this.stopWorker(worker))
    ])
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

  private handleVadMessage(message: unknown): void {
    const value = message as { type?: string; utteranceId?: string; text?: string; final?: boolean; samples?: Float32Array; message?: string }
    if (value.type === 'speech-started') {
      this.speechActivityListener?.(true)
    } else if (value.type === 'speech-stopped') {
      this.speechActivityListener?.(false)
    } else if (value.type === 'audio' && value.samples) {
      this.cloudRecognizer?.accept(value.samples)
    } else if (value.type === 'error') {
      this.errorListener?.(new Error(value.message ?? 'Voice activity detection failed.'))
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
    this.rejectAll(error)
    this.errorListener?.(error)
  }

  private rejectAll(error: Error): void {
    for (const request of this.requests.values()) request.reject(error)
    this.requests.clear()
  }

  private stopWorker(worker: WorkerHandle): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve()
      }
      const timeout = setTimeout(() => {
        // Never force-terminate a worker while a native sherpa/ONNX call may still
        // be active. Detaching lets the current native task finish safely.
        worker.unref()
        finish()
      }, 30_000)
      timeout.unref()
      worker.on('exit', finish)
      try { worker.postMessage({ type: 'stop' }) }
      catch { finish() }
    })
  }

  private startCloudRecognizer(): Promise<void> {
    const apiKey = this.options.aliyunApiKey?.trim()
    if (!apiKey) return Promise.reject(new Error('请先在设置中填写阿里云 DashScope API Key。'))
    const recognizer = this.cloudFactory(apiKey)
    this.cloudRecognizer = recognizer
    recognizer.onTranscript((event) => this.transcriptListener?.(event))
    recognizer.onUsage((seconds) => this.usageListener?.(seconds))
    recognizer.onError((error) => this.errorListener?.(error))
    return recognizer.start()
  }
}
