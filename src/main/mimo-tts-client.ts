type Fetcher = typeof fetch

export interface MimoTtsOptions {
  apiKey: string
  model?: string
  voice?: string
  baseUrl?: string
}

interface AudioPayload {
  data?: unknown
}

function abortError(): Error {
  const error = new Error('MiMo speech synthesis was interrupted.')
  error.name = 'AbortError'
  return error
}

function audioData(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const response = value as {
    choices?: Array<{
      delta?: { audio?: AudioPayload }
      message?: { audio?: AudioPayload }
    }>
  }
  const audio = response.choices?.[0]?.delta?.audio ?? response.choices?.[0]?.message?.audio
  return typeof audio?.data === 'string' ? audio.data : undefined
}

function decodePcm16(chunks: Buffer[]): Float32Array {
  const bytes = Buffer.concat(chunks)
  if (bytes.byteLength === 0) throw new Error('MiMo TTS returned no audio.')
  if (bytes.byteLength % 2 !== 0) throw new Error('MiMo TTS returned malformed PCM16 audio.')
  const samples = new Float32Array(bytes.byteLength / 2)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2) / 32_768
  }
  return samples
}

function parseSseEvent(event: string, chunks: Buffer[]): void {
  const payload = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim()
  if (!payload || payload === '[DONE]') return
  let parsed: unknown
  try { parsed = JSON.parse(payload) }
  catch { throw new Error('MiMo TTS returned an invalid streaming response.') }
  const data = audioData(parsed)
  if (data) chunks.push(Buffer.from(data, 'base64'))
}

async function readStreamingAudio(response: Response, signal: AbortSignal): Promise<Float32Array> {
  if (!response.body) throw new Error('MiMo TTS returned an empty response.')
  const chunks: Buffer[] = []
  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let pending = ''
  while (true) {
    if (signal.aborted) throw abortError()
    const { done, value } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    const events = pending.split(/\r?\n\r?\n/)
    pending = events.pop() ?? ''
    for (const event of events) parseSseEvent(event, chunks)
    if (done) break
  }
  if (pending.trim()) parseSseEvent(pending, chunks)
  return decodePcm16(chunks)
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.text().catch(() => '')).slice(0, 500)
  let detail = body
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown }
    detail = typeof parsed.error?.message === 'string'
      ? parsed.error.message
      : typeof parsed.message === 'string' ? parsed.message : body
  } catch {
    // Keep the bounded response body when the service did not return JSON.
  }
  return new Error(`MiMo TTS request failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`)
}

export class MimoTtsClient {
  private readonly apiKey: string
  private readonly model: string
  private readonly voice: string
  private readonly endpoint: string

  constructor(options: MimoTtsOptions, private readonly fetcher: Fetcher = fetch) {
    this.apiKey = options.apiKey.trim()
    this.model = options.model?.trim() || 'mimo-v2.5-tts'
    this.voice = options.voice?.trim() || 'Mia'
    this.endpoint = `${(options.baseUrl?.trim() || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '')}/chat/completions`
    if (!this.apiKey) throw new Error('请先在设置中填写 Xiaomi MiMo API Key。')
  }

  async synthesize(text: string, signal: AbortSignal): Promise<{ samples: Float32Array; sampleRate: 24000 }> {
    let response: Response
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'assistant', content: text }],
          audio: { format: 'pcm16', voice: this.voice },
          stream: true
        }),
        signal
      })
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw abortError()
      throw error
    }
    if (!response.ok) throw await responseError(response)
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (contentType.includes('application/json')) {
      const data = audioData(await response.json())
      if (!data) throw new Error('MiMo TTS returned no audio.')
      return { samples: decodePcm16([Buffer.from(data, 'base64')]), sampleRate: 24000 }
    }
    return { samples: await readStreamingAudio(response, signal), sampleRate: 24000 }
  }
}
