import { once } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'
import { expect, it } from 'vitest'
import { AliyunAsr, type AsrTranscript } from './aliyun-asr'

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Local ASR event timed out.')), 4_000)
    })])
  } finally { clearTimeout(timer) }
}

it('keeps a real socket streaming beyond eight seconds and resumes transcripts after task failure', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const frames: Array<{ at: number; connection: number; bytes: number }> = []
  const transcripts: AsrTranscript[] = []
  let connections = 0
  let current: WebSocket | undefined
  let signalAudio!: () => void
  const heartbeatSettings: boolean[] = []
  const recoveredAudio = new Promise<void>((resolve) => { signalAudio = resolve })
  server.on('connection', (socket) => {
    const connection = ++connections
    current = socket
    socket.on('message', (data, binary) => {
      if (binary) {
        const bytes = Array.isArray(data) ? Buffer.concat(data).length : data.byteLength
        frames.push({ at: Date.now(), connection, bytes })
        if (connection === 2) signalAudio()
        return
      }
      const command = JSON.parse(data.toString())
      if (command.header.action === 'run-task') {
        heartbeatSettings.push(command.payload.parameters.heartbeat)
        socket.send(JSON.stringify({ header: { event: 'task-started', task_id: command.header.task_id } }))
      }
    })
  })
  const service = new AliyunAsr('local-test-only', () => new WebSocket(`ws://127.0.0.1:${address.port}`))
  let signalTranscript!: () => void
  const finalTranscript = new Promise<void>((resolve) => { signalTranscript = resolve })
  service.onTranscript((event) => { transcripts.push(event); if (event.final) signalTranscript() })
  try {
    await service.start()
    const startedAt = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    expect(connections).toBe(1)
    expect(frames.length).toBeGreaterThan(30)
    expect(frames.every((frame) => frame.bytes === 6_400)).toBe(true)
    const times = [startedAt, ...frames.map((frame) => frame.at), Date.now()]
    expect(Math.max(...times.slice(1).map((time, index) => time - times[index]))).toBeLessThan(8_000)
    // task-failed does not require the remote peer to close the WebSocket.
    current!.send(JSON.stringify({ header: { event: 'task-failed', error_message: 'simulated idle timeout' } }))
    await within(recoveredAudio)
    expect(connections).toBe(2)
    expect(heartbeatSettings).toEqual([true, true])
    for (const final of [false, true]) {
      current!.send(JSON.stringify({ header: { event: 'result-generated' }, payload: {
        output: { sentence: { sentence_id: 1, text: 'I can keep speaking.', sentence_end: final } }
      } }))
    }
    await within(finalTranscript)
    expect(transcripts.map((event) => [event.text, event.final])).toEqual([
      ['I can keep speaking.', false], ['I can keep speaking.', true]
    ])
    expect(transcripts[0].utteranceId).toBe(transcripts[1].utteranceId)
  } finally {
    await service.stop()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 20_000)
