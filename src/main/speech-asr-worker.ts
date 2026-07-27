import { parentPort, workerData } from 'node:worker_threads'
import { join } from 'node:path'
import { OfflineRecognizer, OnlineRecognizer, Vad } from 'sherpa-onnx-node'
import { AudioPreRoll } from './audio-pre-roll'
import { StreamingAsrSession } from './streaming-asr-session'

type Incoming =
  | { type: 'audio'; samples: Float32Array }
  | { type: 'reset' }
  | { type: 'stop' }

const workerPort = parentPort
if (!workerPort) throw new Error('ASR worker must run in a worker thread.')
const port = workerPort
const paths = workerData as { asr: string }

const recognizer = new OnlineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: join(paths.asr, 'encoder.int8.onnx'),
      decoder: join(paths.asr, 'decoder.onnx'),
      joiner: join(paths.asr, 'joiner.int8.onnx')
    },
    tokens: join(paths.asr, 'tokens.txt'),
    numThreads: 2,
    provider: 'cpu'
  },
  decodingMethod: 'greedy_search',
  maxActivePaths: 4,
  enableEndpoint: true,
  rule1MinTrailingSilence: 2.4,
  rule2MinTrailingSilence: 1.2,
  rule3MinUtteranceLength: 20
})

const finalRecognizer = new OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    whisper: {
      encoder: join(paths.asr, 'whisper-base-encoder.int8.onnx'),
      decoder: join(paths.asr, 'whisper-base-decoder.int8.onnx'),
      language: '',
      task: 'transcribe',
      tailPaddings: -1
    },
    tokens: join(paths.asr, 'whisper-base-tokens.txt'),
    numThreads: 2,
    provider: 'cpu'
  }
})

const vad = new Vad({
  sileroVad: {
    model: join(paths.asr, 'silero_vad.onnx'),
    threshold: 0.5,
    minSilenceDuration: 0.7,
    minSpeechDuration: 0.25,
    windowSize: 512,
    maxSpeechDuration: 20
  },
  sampleRate: 16000,
  numThreads: 1,
  provider: 'cpu'
}, 30)

const stream = recognizer.createStream()
const asr = new StreamingAsrSession(
  recognizer,
  stream,
  (event) => port.postMessage({ type: 'transcript', ...event }),
  async (samples, onlineText) => {
    const finalStream = finalRecognizer.createStream()
    finalStream.acceptWaveform({ samples, sampleRate: 16000 })
    const result = await finalRecognizer.decodeAsync(finalStream)
    return result.text?.trim() || onlineText
  }
)

let speechDetected = false
const preRoll = new AudioPreRoll(6_400)

function reset(): void {
  speechDetected = false
  preRoll.clear()
  vad.reset()
  asr.reset()
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
          for (const chunk of preRoll.drain()) asr.accept(chunk)
        }
      } else {
        asr.accept(message.samples)
        if (!detected) {
          speechDetected = false
          asr.finishUtterance()
          port.postMessage({ type: 'speech-stopped' })
        }
      }
      while (!vad.isEmpty()) vad.pop()
    }
    if (message.type === 'reset') reset()
    if (message.type === 'stop') process.exit(0)
  } catch (error) {
    port.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})

port.postMessage({ type: 'ready' })
