import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  receive: undefined as ((message: unknown) => void) | undefined,
  detected: false,
  postMessage: vi.fn(),
  close: vi.fn(),
  reset: vi.fn()
}))
vi.mock('node:worker_threads', () => ({
  parentPort: {
    on: (_event: string, listener: (message: unknown) => void) => { harness.receive = listener },
    postMessage: harness.postMessage,
    close: harness.close
  },
  workerData: { vad: 'test-vad.onnx' }
}))
vi.mock('sherpa-onnx-node', () => ({
  Vad: class {
    acceptWaveform(): void {}
    isDetected(): boolean { return harness.detected }
    isEmpty(): boolean { return true }
    reset = harness.reset
  }
}))

describe('VAD worker continuous ASR transport', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    harness.detected = false
    await import('./speech-vad-worker')
    harness.postMessage.mockClear()
  })

  it('forwards twelve seconds of silence, speech, and trailing silence exactly once in order', () => {
    const input: Float32Array[] = []
    const send = (samples: Float32Array): void => {
      input.push(samples)
      harness.receive!({ type: 'audio', samples })
    }
    for (let index = 0; index < 120; index += 1) send(new Float32Array(1_600))
    harness.detected = true
    send(Float32Array.from([0.1, 0.4, -0.2]))
    harness.detected = false
    for (let index = 0; index < 10; index += 1) send(new Float32Array(1_600))
    const messages = harness.postMessage.mock.calls.map(([message]) => message)
    expect(messages.filter((message) => message.type === 'audio').map((message) => message.samples)).toEqual(input)
    expect(messages.filter((message) => message.type !== 'audio')).toEqual([{ type: 'speech-started' }, { type: 'speech-stopped' }])
    expect(messages[120]).toEqual({ type: 'speech-started' })
  })

  it('continues sending silence after reset and closes cooperatively', () => {
    harness.receive!({ type: 'reset' })
    const samples = new Float32Array(1_600)
    harness.receive!({ type: 'audio', samples })
    expect(harness.reset).toHaveBeenCalledOnce()
    expect(harness.postMessage).toHaveBeenCalledWith({ type: 'audio', samples }, expect.any(Array))
    harness.receive!({ type: 'stop' })
    expect(harness.close).toHaveBeenCalledOnce()
  })
})
