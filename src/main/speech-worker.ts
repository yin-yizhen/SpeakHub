import { parentPort, workerData } from 'node:worker_threads'
import { join } from 'node:path'
import { OfflineTts, OnlineRecognizer } from 'sherpa-onnx-node'
import { StreamingAsrSession } from './streaming-asr-session'

type WorkerPaths = { asr: string; tts: string }
type Incoming =
  | { type: 'audio'; samples: Float32Array }
  | { type: 'synthesize'; requestId: string; messageId: string; index: number; text: string }
  | { type: 'reset' }
  | { type: 'stop' }

const port = parentPort
if (!port) throw new Error('Speech worker must run in a worker thread.')
const paths = workerData as WorkerPaths

const recognizer = new OnlineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: join(paths.asr, 'encoder.int8.onnx'),
      decoder: join(paths.asr, 'decoder.int8.onnx'),
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

const tts = new OfflineTts({
  model: {
    kokoro: {
      model: join(paths.tts, 'model.int8.onnx'),
      voices: join(paths.tts, 'voices.bin'),
      tokens: join(paths.tts, 'tokens.txt'),
      dataDir: join(paths.tts, 'espeak-ng-data'),
      dictDir: join(paths.tts, 'dict'),
      lexicon: join(paths.tts, 'lexicon-zh.txt'),
      lengthScale: 1
    },
    numThreads: 2,
    provider: 'cpu'
  },
  maxNumSentences: 1,
  silenceScale: 0.2
})

const stream = recognizer.createStream()
const asr = new StreamingAsrSession(recognizer, stream, (event) => port.postMessage({ type: 'transcript', ...event }))

port.on('message', (message: Incoming) => {
  try {
    if (message.type === 'audio') asr.accept(message.samples)
    if (message.type === 'reset') asr.reset()
    if (message.type === 'stop') process.exit(0)
    if (message.type === 'synthesize') {
      // Electron disables native external ArrayBuffers; request a copied Float32Array from the addon.
      const audio = tts.generate({ text: message.text, sid: 0, speed: 1, enableExternalBuffer: false })
      const samples = audio.samples.slice()
      port.postMessage({
        type: 'speech',
        requestId: message.requestId,
        messageId: message.messageId,
        index: message.index,
        sampleRate: audio.sampleRate,
        samples
      }, [samples.buffer])
    }
  } catch (error) {
    port.postMessage({ type: 'error', requestId: 'requestId' in message ? message.requestId : undefined, message: error instanceof Error ? error.message : String(error) })
  }
})

port.postMessage({ type: 'ready' })
