export class RealtimeAudioCapture {
  private stream: MediaStream | undefined
  private context: AudioContext | undefined
  private source: MediaStreamAudioSourceNode | undefined
  private processor: AudioWorkletNode | undefined
  private sink: GainNode | undefined
  private workletUrl: string | undefined

  async start(onAudio: (pcm16: ArrayBuffer) => void): Promise<void> {
    this.stop()
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    const source = `class SpeakSubCapture extends AudioWorkletProcessor { process(inputs) { const channel = inputs[0]?.[0]; if (channel?.length) { const copy = channel.slice(); this.port.postMessage(copy.buffer, [copy.buffer]); } return true } } registerProcessor('speaksub-capture', SpeakSubCapture)`
    this.workletUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    await this.context.audioWorklet.addModule(this.workletUrl)
    this.processor = new AudioWorkletNode(this.context, 'speaksub-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    this.processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onAudio(toPcm16(new Float32Array(event.data), this.context!.sampleRate))
    this.sink = this.context.createGain(); this.sink.gain.value = 0
    this.source.connect(this.processor); this.processor.connect(this.sink); this.sink.connect(this.context.destination)
  }

  stop(): void {
    this.processor?.port.close(); this.processor?.disconnect(); this.sink?.disconnect(); this.source?.disconnect(); this.stream?.getTracks().forEach((track) => track.stop()); void this.context?.close()
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl)
    this.processor = undefined; this.sink = undefined; this.source = undefined; this.stream = undefined; this.context = undefined; this.workletUrl = undefined
  }
}

export class RealtimeAudioPlayer {
  private context: AudioContext | undefined
  private scheduledAt = 0
  private readonly nodes = new Set<AudioBufferSourceNode>()

  play(pcm16: ArrayBuffer): void {
    this.context ??= new AudioContext()
    const samples = new Int16Array(pcm16); const buffer = this.context.createBuffer(1, samples.length, 24000)
    const channel = buffer.getChannelData(0)
    for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 32768
    const node = this.context.createBufferSource(); node.buffer = buffer; node.connect(this.context.destination); this.nodes.add(node); node.onended = () => this.nodes.delete(node)
    const at = Math.max(this.context.currentTime, this.scheduledAt); node.start(at); this.scheduledAt = at + buffer.duration
  }

  interrupt(): void { for (const node of this.nodes) { try { node.stop() } catch { /* already stopped */ } }; this.nodes.clear(); this.scheduledAt = this.context?.currentTime ?? 0 }
  stop(): void { this.interrupt(); this.scheduledAt = 0; void this.context?.close(); this.context = undefined }
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

function toPcm16(input: Float32Array, sampleRate: number): ArrayBuffer {
  const ratio = sampleRate / 24000; const output = new Int16Array(Math.floor(input.length / ratio))
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio; const lower = Math.floor(position); const upper = Math.min(input.length - 1, lower + 1); const fraction = position - lower
    const sample = Math.max(-1, Math.min(1, input[lower] * (1 - fraction) + input[upper] * fraction))
    output[index] = sample < 0 ? sample * 32768 : sample * 32767
  }
  return output.buffer
}
