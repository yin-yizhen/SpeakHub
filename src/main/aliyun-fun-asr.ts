import { randomUUID } from 'node:crypto'
import WebSocket, { type ClientOptions, type RawData } from 'ws'

export const ALIYUN_FUN_ASR_MODEL = 'fun-asr-realtime-2025-09-15'
export const ALIYUN_FUN_ASR_CNY_PER_SECOND = 0.00033
const ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
const MAX_BUFFERED_SAMPLES = 32_000

export type AsrTranscript = { utteranceId: string; text: string; final: boolean }
type SocketLike = Pick<WebSocket, 'on' | 'send' | 'close' | 'readyState'>
type SocketFactory = (url: string, options: ClientOptions) => SocketLike

const unsupportedScript = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const meaningful = /[\p{Script=Han}\p{Script=Latin}\p{Number}]/u

export function float32ToPcm16(samples: Float32Array): Buffer {
  const result = Buffer.allocUnsafe(samples.length * 2)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    result.writeInt16LE(value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff), index * 2)
  }
  return result
}

export function isSupportedBilingualTranscript(text: string): boolean {
  return meaningful.test(text) && !unsupportedScript.test(text)
}

export class AliyunFunAsr {
  private socket?: SocketLike
  private taskId = ''
  private state: 'idle' | 'connecting' | 'ready' | 'closed' = 'idle'
  private stopped = false
  private buffered: Float32Array[] = []
  private bufferedSamples = 0
  private completedUsageSeconds = 0
  private taskUsageSeconds = 0
  private startPromise?: Promise<void>
  private transcriptListener?: (event: AsrTranscript) => void
  private usageListener?: (cumulativeSeconds: number) => void
  private errorListener?: (error: Error) => void

  constructor(
    private readonly apiKey: string,
    private readonly socketFactory: SocketFactory = (url, options) => new WebSocket(url, options)
  ) {}

  onTranscript(listener: (event: AsrTranscript) => void): void { this.transcriptListener = listener }
  onUsage(listener: (cumulativeSeconds: number) => void): void { this.usageListener = listener }
  onError(listener: (error: Error) => void): void { this.errorListener = listener }

  start(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve()
    if (this.startPromise) return this.startPromise
    this.stopped = false
    this.state = 'connecting'
    this.taskId = randomUUID()
    this.startPromise = new Promise<void>((resolve, reject) => {
      const socket = this.socketFactory(ENDPOINT, { headers: { Authorization: `Bearer ${this.apiKey}`, 'X-DashScope-DataInspection': 'enable' } })
      this.socket = socket
      const timeout = setTimeout(() => {
        const error = new Error('阿里云语音识别连接超时。')
        reject(error)
        this.reportError(error)
        socket.close()
      }, 5_000)
      socket.on('open', () => socket.send(JSON.stringify(this.startMessage())))
      socket.on('message', (data) => {
        try {
          const event = this.parseMessage(data as RawData)
          if (event === 'ready') {
            clearTimeout(timeout)
            this.state = 'ready'
            this.flushBuffered()
            resolve()
          }
        } catch (error) {
          const next = error instanceof Error ? error : new Error(String(error))
          clearTimeout(timeout)
          reject(next)
          this.reportError(next)
        }
      })
      socket.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
        this.reportError(error)
      })
      socket.on('close', () => {
        clearTimeout(timeout)
        this.state = 'closed'
        this.startPromise = undefined
        if (!this.stopped) {
          this.completedUsageSeconds += this.taskUsageSeconds
          this.taskUsageSeconds = 0
          this.reportError(new Error('阿里云语音识别连接已断开，正在等待重连。'))
        }
      })
    })
    return this.startPromise
  }

  accept(samples: Float32Array): void {
    if (this.stopped) return
    if (this.state !== 'ready' || !this.socket) {
      this.buffer(samples)
      void this.start().catch(() => undefined)
      return
    }
    this.socket.send(float32ToPcm16(samples))
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.socket && this.state === 'ready') this.socket.send(JSON.stringify(this.finishMessage()))
    this.socket?.close()
    this.socket = undefined
    this.state = 'closed'
    this.startPromise = undefined
    this.buffered = []
    this.bufferedSamples = 0
  }

  private startMessage(): unknown {
    return {
      header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: ALIYUN_FUN_ASR_MODEL,
        input: {},
        parameters: {
          format: 'pcm',
          sample_rate: 16_000,
          semantic_punctuation_enabled: false,
          max_sentence_silence: 700,
          heartbeat: true
        }
      }
    }
  }

  private finishMessage(): unknown {
    return { header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' }, payload: { input: {} } }
  }

  private parseMessage(raw: RawData): 'ready' | 'handled' {
    const event = JSON.parse(raw.toString()) as {
      header?: { event?: string; error_message?: string }
      payload?: {
        output?: { sentence?: { text?: string; sentence_end?: boolean; sentence_id?: number; heartbeat?: boolean } }
        usage?: { duration?: number } | null
      }
    }
    if (event.header?.event === 'task-started') return 'ready'
    if (event.header?.event === 'task-failed') throw new Error(event.header.error_message || '阿里云语音识别任务失败。')
    if (event.header?.event !== 'result-generated') return 'handled'
    const sentence = event.payload?.output?.sentence
    if (!sentence || sentence.heartbeat) return 'handled'
    const text = sentence.text?.trim() ?? ''
    const final = sentence.sentence_end === true
    if (text && isSupportedBilingualTranscript(text)) {
      this.transcriptListener?.({
        utteranceId: `aliyun-asr-${this.taskId}-${sentence.sentence_id ?? 0}`,
        text,
        final
      })
    } else if (final && text) {
      this.reportError(new Error('识别结果出现中英文之外的文字，已拦截，请再说一次。'))
    }
    const duration = event.payload?.usage?.duration
    if (final && Number.isFinite(duration)) {
      this.taskUsageSeconds = Math.max(this.taskUsageSeconds, Math.max(0, Math.floor(duration!)))
      this.usageListener?.(this.completedUsageSeconds + this.taskUsageSeconds)
    }
    return 'handled'
  }

  private buffer(samples: Float32Array): void {
    const copy = samples.slice()
    this.buffered.push(copy)
    this.bufferedSamples += copy.length
    while (this.bufferedSamples > MAX_BUFFERED_SAMPLES && this.buffered.length) {
      const removed = this.buffered.shift()!
      this.bufferedSamples -= removed.length
    }
  }

  private flushBuffered(): void {
    const chunks = this.buffered
    this.buffered = []
    this.bufferedSamples = 0
    for (const chunk of chunks) this.socket?.send(float32ToPcm16(chunk))
  }

  private reportError(error: Error): void { this.errorListener?.(error) }
}
