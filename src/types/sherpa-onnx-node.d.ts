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

  export class OfflineRecognizer {
    constructor(config: Record<string, unknown>)
    createStream(): {
      acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void
    }
    decodeAsync(stream: unknown): Promise<{ text?: string; lang?: string }>
    getResult(stream: unknown): { text?: string; lang?: string }
  }

  export class OfflineTts {
    constructor(config: Record<string, unknown>)
    readonly sampleRate: number
    generate(input: { text: string; sid: number; speed: number; enableExternalBuffer?: boolean }): { samples: Float32Array; sampleRate: number }
    generateAsync(input: { text: string; sid: number; speed: number; enableExternalBuffer?: boolean }): Promise<{ samples: Float32Array; sampleRate: number }>
  }

  export class Vad {
    constructor(config: Record<string, unknown>, bufferSizeInSeconds: number)
    acceptWaveform(samples: Float32Array): void
    isEmpty(): boolean
    isDetected(): boolean
    pop(): void
    clear(): void
    front(enableExternalBuffer?: boolean): { samples: Float32Array; start: number }
    reset(): void
    flush(): void
  }
}
