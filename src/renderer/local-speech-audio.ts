import type { GeneratedSpeechChunk, VoiceAudioChunk, VoiceCaptureStatus } from '../shared/types'

export const captureChunkFrames = 2048
export const microphoneSignalThreshold = 0.012

export function microphoneSignalLevel(samples: Float32Array): number {
  if (!samples.length) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

export class LocalSpeechAudioCapture {
  private stream: MediaStream | undefined
  private context: AudioContext | undefined
  private source: MediaStreamAudioSourceNode | undefined
  private processor: AudioWorkletNode | undefined
  private sink: GainNode | undefined
  private workletUrl: string | undefined

  async start(onAudio: (chunk: VoiceAudioChunk) => void): Promise<VoiceCaptureStatus> {
    this.stop()
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    const source = `class SpeakSubCapture extends AudioWorkletProcessor {
      constructor() { super(); this.buffer = new Float32Array(${captureChunkFrames}); this.offset = 0; }
      process(inputs) {
        const channel = inputs[0]?.[0];
        if (!channel?.length) return true;
        let inputOffset = 0;
        while (inputOffset < channel.length) {
          const count = Math.min(channel.length - inputOffset, this.buffer.length - this.offset);
          this.buffer.set(channel.subarray(inputOffset, inputOffset + count), this.offset);
          this.offset += count;
          inputOffset += count;
          if (this.offset === this.buffer.length) {
            const output = this.buffer;
            this.port.postMessage(output.buffer, [output.buffer]);
            this.buffer = new Float32Array(${captureChunkFrames});
            this.offset = 0;
          }
        }
        return true;
      }
    } registerProcessor('speaksub-capture', SpeakSubCapture)`
    this.workletUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    await this.context.audioWorklet.addModule(this.workletUrl)
    this.processor = new AudioWorkletNode(this.context, 'speaksub-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    this.processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const samples = resampleFloat32(new Float32Array(event.data), this.context!.sampleRate, 16000)
      onAudio({ sampleRate: 16000, format: 'float32', samples: samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer })
    }
    this.sink = this.context.createGain(); this.sink.gain.value = 0
    this.source.connect(this.processor); this.processor.connect(this.sink); this.sink.connect(this.context.destination)
    const settings = this.stream.getAudioTracks()[0]?.getSettings()
    return { echoCancellation: settings?.echoCancellation !== false }
  }

  stop(): void {
    this.processor?.port.close(); this.processor?.disconnect(); this.sink?.disconnect(); this.source?.disconnect(); this.stream?.getTracks().forEach((track) => track.stop()); void this.context?.close()
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl)
    this.processor = undefined; this.sink = undefined; this.source = undefined; this.stream = undefined; this.context = undefined; this.workletUrl = undefined
  }
}

export class LocalSpeechAudioPlayer {
  private context: AudioContext | undefined
  private scheduledAt = 0
  private generation = 0
  private readonly nodes = new Set<AudioBufferSourceNode>()

  play(chunk: GeneratedSpeechChunk, onEnded?: () => void): void {
    if (!isPlayableSpeechGeneration(this.generation, chunk.generation)) return
    if (chunk.generation > this.generation) this.generation = chunk.generation
    this.context ??= new AudioContext()
    void this.context.resume()
    const samples = new Float32Array(chunk.samples); const buffer = this.context.createBuffer(1, samples.length, chunk.sampleRate)
    buffer.copyToChannel(samples, 0)
    const node = this.context.createBufferSource(); node.buffer = buffer; node.connect(this.context.destination); this.nodes.add(node); node.onended = () => { this.nodes.delete(node); onEnded?.() }
    const at = Math.max(this.context.currentTime, this.scheduledAt); node.start(at); this.scheduledAt = at + buffer.duration
  }

  interrupt(generation = this.generation + 1): void { this.generation = Math.max(this.generation, generation); for (const node of this.nodes) { try { node.stop() } catch { /* already stopped */ } }; this.nodes.clear(); this.scheduledAt = this.context?.currentTime ?? 0 }
  stop(): void { this.interrupt(); this.generation = 0; this.scheduledAt = 0; void this.context?.close(); this.context = undefined }
}

export function isPlayableSpeechGeneration(current: number, incoming: number): boolean {
  return incoming >= current
}

const microphoneOnTones = [261.63, 329.63, 392] as const
const microphoneOffTones = [...microphoneOnTones].reverse() as [number, number, number]

export function microphoneToggleTones(enabled: boolean): readonly number[] {
  return enabled ? microphoneOnTones : microphoneOffTones
}

export function playMicrophoneToggleTone(enabled: boolean): void {
  const AudioContextConstructor = window.AudioContext
  if (!AudioContextConstructor) return
  const context = new AudioContextConstructor()
  void context.resume()
  const tones = microphoneToggleTones(enabled)
  const noteLength = 0.11
  const noteSpacing = 0.09
  const startedAt = context.currentTime + 0.01
  tones.forEach((frequency, index) => {
    const start = startedAt + index * noteSpacing
    const stop = start + noteLength
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.07, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, stop)
    oscillator.connect(gain); gain.connect(context.destination)
    if (index === tones.length - 1) oscillator.onended = () => void context.close()
    oscillator.start(start); oscillator.stop(stop)
  })
}

export function resampleFloat32(input: Float32Array, sampleRate: number, targetRate = 16000): Float32Array {
  const ratio = sampleRate / targetRate; const output = new Float32Array(Math.floor(input.length / ratio))
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio; const lower = Math.floor(position); const upper = Math.min(input.length - 1, lower + 1); const fraction = position - lower
    output[index] = Math.max(-1, Math.min(1, input[lower] * (1 - fraction) + input[upper] * fraction))
  }
  return output
}
