import { randomUUID } from 'node:crypto'
import WebSocket, { type ClientOptions, type RawData } from 'ws'
import type { SpeechRecognitionLanguage } from '../shared/types'

export const ALIYUN_ASR_MODEL = 'paraformer-realtime-v2'
export const ALIYUN_ASR_CNY_PER_SECOND = 0.00024
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

export class AliyunAsr {
  private socket?: SocketLike
  private taskId = ''
  private state: 'idle' | 'connecting' | 'ready' | 'closed' = 'idle'
  private stopped = false
  private buffered: Float32Array[] = []
  private bufferedSamples = 0
  private completedUsageSeconds = 0
  private taskUsageSeconds = 0
  private startPromise?: Promise<void>
  private endConnection?: (error: Error, report?: boolean) => void
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private keepAliveTimer?: ReturnType<typeof setInterval>
  private reconnectDelay = 1_000
  private hasConnected = false
  private lastAudioAt = 0
  private transcriptListener?: (event: AsrTranscript) => void
  private usageListener?: (cumulativeSeconds: number) => void
  private errorListener?: (error: Error) => void

  constructor(
    private readonly apiKey: string,
    private readonly socketFactory: SocketFactory = (url, options) => new WebSocket(url, options),
    private readonly language: SpeechRecognitionLanguage = 'en'
  ) {}

  onTranscript(listener: (event: AsrTranscript) => void): void { this.transcriptListener = listener }
  onUsage(listener: (cumulativeSeconds: number) => void): void { this.usageListener = listener }
  onError(listener: (error: Error) => void): void { this.errorListener = listener }

  start(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve()
    if (this.startPromise) return this.startPromise
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.stopped = false
    this.state = 'connecting'
    this.taskId = randomUUID()
    let resolve!: () => void
    let reject!: (error: Error) => void
    const starting = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    this.startPromise = starting
    let ended = false
    let socket: SocketLike | undefined
    const timeout = setTimeout(() => fail(new Error('阿里云语音识别连接超时。')), 5_000)
    const fail = (error: Error, report = true): void => {
      if (ended) return
      ended = true
      clearTimeout(timeout)
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = undefined
      this.socket = undefined
      this.state = 'closed'
      this.startPromise = undefined
      this.endConnection = undefined
      this.completedUsageSeconds += this.taskUsageSeconds
      this.taskUsageSeconds = 0
      reject(error)
      // Detach this attempt before close: old socket events must never change
      // the state, task ID, or usage of a replacement connection.
      try { socket?.close() } catch { /* already closed */ }
      if (!this.stopped && this.hasConnected) this.scheduleReconnect()
      if (report && !this.stopped) this.reportError(error)
    }
    this.endConnection = fail
    try {
      socket = this.socketFactory(ENDPOINT, { headers: { Authorization: `Bearer ${this.apiKey}`, 'X-DashScope-DataInspection': 'enable' } })
      this.socket = socket
      socket.on('open', () => {
        if (ended) return
        try { socket!.send(JSON.stringify(this.startMessage())) }
        catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
      })
      socket.on('message', (data) => {
        if (ended) return
        try {
          const event = this.parseMessage(data as RawData)
          if (event === 'ready' && this.state === 'connecting') {
            clearTimeout(timeout)
            this.state = 'ready'
            this.hasConnected = true
            this.reconnectDelay = 1_000
            this.lastAudioAt = Date.now()
            this.flushBuffered()
            // Capture can be intentionally muted or not yet started. Supply
            // only synthetic silence then, never reopen the microphone.
            this.keepAliveTimer = setInterval(() => {
              if (Date.now() - this.lastAudioAt >= 200) this.sendAudio(new Float32Array(3_200))
            }, 200)
            this.keepAliveTimer.unref()
            resolve()
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      })
      socket.on('error', (error) => fail(error))
      socket.on('close', () => fail(new Error('阿里云语音识别连接已断开，正在自动重连。')))
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
    return starting
  }

  accept(samples: Float32Array): void {
    if (this.stopped) return
    if (this.state !== 'ready' || !this.socket) {
      this.buffer(samples)
      if (!this.reconnectTimer) void this.start().catch(() => undefined)
      return
    }
    this.sendAudio(samples)
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = undefined
    try {
      if (this.socket?.readyState === WebSocket.OPEN && this.state === 'ready') this.socket.send(JSON.stringify(this.finishMessage()))
    } catch {
      // A broken transport must not prevent local shutdown and timer cleanup.
    } finally {
      this.endConnection?.(new Error('语音识别已停止。'), false)
    }
    this.socket = undefined
    this.state = 'closed'
    this.startPromise = undefined
    this.buffered = []
    this.bufferedSamples = 0
    this.hasConnected = false
    this.reconnectDelay = 1_000
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.start().catch(() => undefined)
    }, this.reconnectDelay)
    this.reconnectTimer.unref()
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8_000)
  }

  private sendAudio(samples: Float32Array): void {
    try {
      if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('阿里云语音识别连接不可用，正在自动重连。')
      this.socket.send(float32ToPcm16(samples))
      this.lastAudioAt = Date.now()
    } catch (error) {
      this.endConnection?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private startMessage(): unknown {
    return {
      header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: ALIYUN_ASR_MODEL,
        input: {},
        parameters: {
          format: 'pcm',
          sample_rate: 16_000,
          ...(this.language === 'en' ? { language_hints: ['en'] } : {}),
          disfluency_removal_enabled: false,
          semantic_punctuation_enabled: false,
          max_sentence_silence: 1_100,
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
    if (event.header?.event === 'task-finished') throw new Error('阿里云语音识别任务已结束，正在自动重连。')
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
