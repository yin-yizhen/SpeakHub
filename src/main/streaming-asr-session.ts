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

  constructor(
    private readonly recognizer: OnlineRecognizer,
    private readonly stream: OnlineStream,
    private readonly emit: (event: { utteranceId: string; text: string; final: boolean }) => void
  ) {}

  accept(samples: Float32Array): void {
    this.stream.acceptWaveform({ samples, sampleRate: 16000 })
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    const text = this.recognizer.getResult(this.stream).text?.trim() ?? ''
    if (text && text !== this.lastText) {
      this.lastText = text
      this.emit({ utteranceId: this.id, text, final: false })
    }
    if (this.recognizer.isEndpoint(this.stream)) {
      if (text) this.emit({ utteranceId: this.id, text, final: true })
      this.reset()
    }
  }

  reset(): void {
    this.recognizer.reset(this.stream)
    this.utterance += 1
    this.lastText = ''
  }

  private get id(): string { return `local-asr-${this.utterance}` }
}
