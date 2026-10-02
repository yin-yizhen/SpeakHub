import { parentPort, workerData } from 'node:worker_threads'
import { Vad } from 'sherpa-onnx-node'

type Incoming =
  | { type: 'audio'; samples: Float32Array }
  | { type: 'reset' }
  | { type: 'stop' }

const workerPort = parentPort
if (!workerPort) throw new Error('VAD worker must run in a worker thread.')
const port = workerPort
const paths = workerData as { vad: string }

const vad = new Vad({
  sileroVad: {
    model: paths.vad,
    threshold: 0.5,
    minSilenceDuration: 0.7,
    minSpeechDuration: 0.25,
    windowSize: 512,
    maxSpeechDuration: 20
  },
  sampleRate: 16_000,
  numThreads: 1,
  provider: 'cpu'
}, 30)

let speechDetected = false

function emitAudio(chunk: Float32Array): void {
  const copy = chunk.slice()
  port.postMessage({ type: 'audio', samples: copy }, [copy.buffer])
}

function reset(): void {
  speechDetected = false
  vad.reset()
}

port.on('message', (message: Incoming) => {
  try {
    if (message.type === 'audio') {
      vad.acceptWaveform(message.samples)
      const detected = vad.isDetected()
      if (detected !== speechDetected) {
        speechDetected = detected
        port.postMessage({ type: detected ? 'speech-started' : 'speech-stopped' })
      }
      // ASR needs continuous audio, including sentence-ending silence. VAD
      // controls barge-in notifications, not transport or utterance boundaries.
      emitAudio(message.samples)
      while (!vad.isEmpty()) vad.pop()
    }
    if (message.type === 'reset') reset()
    if (message.type === 'stop') {
      try { port.postMessage({ type: 'stopped' }) }
      finally { port.close() }
    }
  } catch (error) {
    port.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})

port.postMessage({ type: 'ready' })
