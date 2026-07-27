import { parentPort, workerData } from 'node:worker_threads'
import { Vad } from 'sherpa-onnx-node'
import { AudioPreRoll } from './audio-pre-roll'

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
const preRoll = new AudioPreRoll(6_400)

function emitAudio(chunk: Float32Array): void {
  const copy = chunk.slice()
  port.postMessage({ type: 'audio', samples: copy }, [copy.buffer])
}

function reset(): void {
  speechDetected = false
  preRoll.clear()
  vad.reset()
}

port.on('message', (message: Incoming) => {
  try {
    if (message.type === 'audio') {
      vad.acceptWaveform(message.samples)
      const detected = vad.isDetected()
      if (!speechDetected) {
        preRoll.push(message.samples)
        if (detected) {
          speechDetected = true
          port.postMessage({ type: 'speech-started' })
          for (const chunk of preRoll.drain()) emitAudio(chunk)
        }
      } else {
        emitAudio(message.samples)
        if (!detected) {
          speechDetected = false
          port.postMessage({ type: 'speech-stopped' })
        }
      }
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
