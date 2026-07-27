declare module 'sherpa-onnx-node' {
  export class OnlineRecognizer {
    constructor(config: Record<string, unknown>)
    createStream(): {
      acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void
      inputFinished(): void
    }
    isReady(stream: unknown): boolean
    decode(stream: unknown): void
    isEndpoint(stream: unknown): boolean
    reset(stream: unknown): void
    getResult(stream: unknown): { text?: string }
  }

  export class OfflineTts {
    constructor(config: Record<string, unknown>)
    readonly sampleRate: number
    generate(input: { text: string; sid: number; speed: number; enableExternalBuffer?: boolean }): { samples: Float32Array; sampleRate: number }
  }
}
