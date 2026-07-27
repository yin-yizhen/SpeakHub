import { parentPort, workerData } from 'node:worker_threads'
import { join } from 'node:path'
import { OfflineTts } from 'sherpa-onnx-node'

type Incoming =
  | { type: 'synthesize'; requestId: string; messageId: string; index: number; generation: number; text: string }
  | { type: 'cancel'; generation: number }
  | { type: 'stop' }

const workerPort = parentPort
if (!workerPort) throw new Error('TTS worker must run in a worker thread.')
const port = workerPort
const paths = workerData as { tts: string }

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

let minimumGeneration = 0
let tail = Promise.resolve()
let stopping = false

function synthesize(message: Extract<Incoming, { type: 'synthesize' }>): void {
  if (stopping) return
  tail = tail.then(async () => {
    if (message.generation < minimumGeneration) return
    try {
      const audio = await tts.generateAsync({ text: message.text, sid: 0, speed: 1, enableExternalBuffer: false })
      if (message.generation < minimumGeneration) return
      const samples = audio.samples.slice()
      port.postMessage({
        type: 'speech',
        requestId: message.requestId,
        messageId: message.messageId,
        index: message.index,
        generation: message.generation,
        sampleRate: audio.sampleRate,
        samples
      }, [samples.buffer])
    } catch (error) {
      port.postMessage({ type: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) })
    }
  })
}

port.on('message', (message: Incoming) => {
  if (message.type === 'synthesize') synthesize(message)
  if (message.type === 'cancel') minimumGeneration = Math.max(minimumGeneration, message.generation + 1)
  if (message.type === 'stop' && !stopping) {
    stopping = true
    minimumGeneration = Number.POSITIVE_INFINITY
    void tail.finally(() => {
      try { port.postMessage({ type: 'stopped' }) }
      finally { port.close() }
    }).catch(() => undefined)
  }
})

port.postMessage({ type: 'ready' })
