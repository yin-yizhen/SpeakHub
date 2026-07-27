type OnlineStream = { acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void }
type OnlineRecognizer = {
  isReady(stream: OnlineStream): boolean
  decode(stream: OnlineStream): void
  isEndpoint(stream: OnlineStream): boolean
  reset(stream: OnlineStream): void
  getResult(stream: OnlineStream): { text?: string }
}

export class StreamingAsrSession {
  private utterance = 0
  private lastText = ''
  private audio: Float32Array[] = []
  private generation = 0

  constructor(
    private readonly recognizer: OnlineRecognizer,
    private readonly stream: OnlineStream,
    private readonly emit: (event: { utteranceId: string; text: string; final: boolean }) => void,
    private readonly finalize?: (samples: Float32Array, onlineText: string) => string | Promise<string>
  ) {}

  accept(samples: Float32Array): void {
    this.audio.push(samples.slice())
    this.stream.acceptWaveform({ samples, sampleRate: 16000 })
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    const text = this.recognizer.getResult(this.stream).text?.trim() ?? ''
    if (text && text !== this.lastText) {
      this.lastText = text
      this.emit({ utteranceId: this.id, text, final: false })
    }
    if (this.recognizer.isEndpoint(this.stream)) this.finishUtterance(text)
  }

  finishUtterance(fallback?: string): void {
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    const text = (fallback === undefined ? this.recognizer.getResult(this.stream).text?.trim() : fallback.trim()) || this.lastText
    if (!text && this.audio.length === 0) return
    const utteranceId = this.id
    const audio = concatenate(this.audio)
    const generation = this.generation
    this.advance()
    if (!text) return
    const corrected = this.finalize?.(audio, text) ?? text
    if (typeof corrected === 'string') {
      this.emitFinal(utteranceId, corrected, text, generation)
      return
    }
    void corrected
      .then((result) => this.emitFinal(utteranceId, result, text, generation))
      .catch(() => this.emitFinal(utteranceId, text, text, generation))
  }

  reset(): void {
    this.generation += 1
    this.advance()
  }

  private advance(): void {
    this.recognizer.reset(this.stream)
    this.utterance += 1
    this.lastText = ''
    this.audio = []
  }

  private emitFinal(utteranceId: string, corrected: string, fallback: string, generation: number): void {
    if (generation !== this.generation) return
    const text = corrected.trim() || fallback
    if (text) this.emit({ utteranceId, text, final: true })
  }

  private get id(): string { return `local-asr-${this.utterance}` }
}

function concatenate(chunks: Float32Array[]): Float32Array {
  const output = new Float32Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}
