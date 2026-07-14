export interface RealtimeSocket {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
  send(data: string): void
  close(): void
}

export interface RealtimeVoiceEvents {
  onStatus(message: string): void
  onTranscript(speaker: 'user' | 'assistant', text: string, sourceMessageId: string): void
  onAudio(pcm16: ArrayBuffer): void
  onError(message: string): void
  onInterrupt?(): void
}

export type RealtimeProtocolProfile = 'current' | 'legacy'

export function realtimeUrl(baseUrl: string, model: string): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/realtime`
  url.search = new URLSearchParams({ model }).toString()
  return url.toString()
}

function decodeBase64(value: string): ArrayBuffer {
  const buffer = Buffer.from(value, 'base64')
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

export class RealtimeVoiceService {
  private socket: RealtimeSocket | undefined

  constructor(private readonly createSocket: (url: string, protocols?: string | string[]) => RealtimeSocket = (url, protocols) => new WebSocket(url, protocols) as unknown as RealtimeSocket) {}

  start(config: { baseUrl?: string; model?: string; apiKey?: string; instructions: string; protocol?: RealtimeProtocolProfile; connectTimeoutMs?: number }, events: RealtimeVoiceEvents): Promise<void> {
    if (!config.baseUrl || !config.model || !config.apiKey) return Promise.reject(new Error('Realtime voice requires a Base URL, Realtime model, and API key.'))
    this.stop()
    return new Promise((resolve, reject) => {
      const socket = this.createSocket(realtimeUrl(config.baseUrl!, config.model!), ['realtime', `openai-insecure-api-key.${config.apiKey}`])
      this.socket = socket
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true; socket.close(); reject(new Error('Realtime voice connection timed out.'))
      }, config.connectTimeoutMs ?? 10_000)
      socket.onopen = () => {
        const session = config.protocol === 'legacy'
          ? { modalities: ['text', 'audio'], instructions: config.instructions, input_audio_format: 'pcm16', output_audio_format: 'pcm16', input_audio_transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad' } }
          : { type: 'realtime', model: config.model, output_modalities: ['audio'], instructions: config.instructions, audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad' } }, output: { format: { type: 'audio/pcm' }, voice: 'marin' } } }
        socket.send(JSON.stringify({ type: 'session.update', session }))
        events.onStatus('Voice conversation is listening. Start speaking when ready.')
        clearTimeout(timeout)
        settled = true
        resolve()
      }
      socket.onerror = () => {
        const error = new Error('Realtime voice connection failed. Check the model, endpoint, and API key.')
        if (!settled) { clearTimeout(timeout); settled = true; reject(error) } else events.onError(error.message)
      }
      socket.onclose = () => {
        if (this.socket === socket) this.socket = undefined
        if (!settled) { clearTimeout(timeout); settled = true; reject(new Error('Realtime voice connection closed before it was ready.')) }
      }
      socket.onmessage = (event) => {
        try { this.handleMessage(JSON.parse(event.data) as Record<string, unknown>, events) }
        catch { events.onError('Realtime voice returned an unreadable event.') }
      }
    })
  }

  appendAudio(pcm16: ArrayBuffer): void {
    if (!this.socket || this.socket.readyState !== 1) return
    this.socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.from(pcm16).toString('base64') }))
  }

  stop(): void { this.socket?.close(); this.socket = undefined }

  private handleMessage(message: Record<string, unknown>, events: RealtimeVoiceEvents): void {
    const type = String(message.type ?? '')
    if ((type === 'response.audio.delta' || type === 'response.output_audio.delta') && typeof message.delta === 'string') events.onAudio(decodeBase64(message.delta))
    if (type === 'conversation.item.input_audio_transcription.completed' && typeof message.transcript === 'string') events.onTranscript('user', message.transcript, String(message.item_id ?? `realtime-user-${Date.now()}`))
    if ((type === 'response.audio_transcript.done' || type === 'response.output_audio_transcript.done') && typeof message.transcript === 'string') events.onTranscript('assistant', message.transcript, String(message.item_id ?? `realtime-assistant-${Date.now()}`))
    if (type === 'input_audio_buffer.speech_started') events.onInterrupt?.()
    if (type === 'error') events.onError(String((message.error as { message?: string } | undefined)?.message ?? 'Realtime voice request failed.'))
  }
}
