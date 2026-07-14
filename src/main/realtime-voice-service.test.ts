import { describe, expect, it, vi } from 'vitest'
import { RealtimeVoiceService, realtimeUrl, type RealtimeSocket } from './realtime-voice-service'

class FakeSocket implements RealtimeSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  send(data: string): void { this.sent.push(data) }
  close(): void { this.onclose?.() }
}

describe('RealtimeVoiceService', () => {
  it('normalizes an OpenAI-compatible realtime endpoint', () => {
    expect(realtimeUrl('https://example.com/v1', 'voice-model')).toBe('wss://example.com/v1/realtime?model=voice-model')
  })

  it('initializes the session, streams audio, maps transcripts and cleans up', async () => {
    const socket = new FakeSocket(); const createSocket = vi.fn(() => socket)
    const events = { onStatus: vi.fn(), onTranscript: vi.fn(), onAudio: vi.fn(), onError: vi.fn(), onInterrupt: vi.fn() }
    const service = new RealtimeVoiceService(createSocket)
    const started = service.start({ baseUrl: 'https://example.com/v1', model: 'voice-model', apiKey: 'secret', instructions: 'Speak English.' }, events)
    socket.readyState = 1; socket.onopen?.(); await started
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: 'session.update', session: { type: 'realtime', output_modalities: ['audio'], audio: { input: { turn_detection: { type: 'server_vad' } } } } })
    service.appendAudio(new Uint8Array([1, 2]).buffer)
    expect(JSON.parse(socket.sent[1])).toMatchObject({ type: 'input_audio_buffer.append' })
    socket.onmessage?.({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Hello there' }) })
    socket.onmessage?.({ data: JSON.stringify({ type: 'response.audio_transcript.done', item_id: 'a1', transcript: 'Hello!' }) })
    socket.onmessage?.({ data: JSON.stringify({ type: 'response.output_audio.delta', delta: Buffer.from([4, 5]).toString('base64') }) })
    socket.onmessage?.({ data: JSON.stringify({ type: 'input_audio_buffer.speech_started' }) })
    expect(events.onTranscript).toHaveBeenNthCalledWith(1, 'user', 'Hello there', 'u1')
    expect(events.onTranscript).toHaveBeenNthCalledWith(2, 'assistant', 'Hello!', 'a1')
    expect(events.onAudio).toHaveBeenCalledOnce()
    expect(events.onInterrupt).toHaveBeenCalledOnce()
    service.stop(); expect(socket.onclose).toBeTruthy()
  })

  it('rejects incomplete voice configuration', async () => {
    await expect(new RealtimeVoiceService(() => new FakeSocket()).start({ instructions: 'x' }, { onStatus: vi.fn(), onTranscript: vi.fn(), onAudio: vi.fn(), onError: vi.fn() })).rejects.toThrow('Realtime voice requires')
  })

  it('supports the explicit legacy profile', async () => {
    const socket = new FakeSocket(); const service = new RealtimeVoiceService(() => socket)
    const started = service.start({ baseUrl: 'https://example.com/v1', model: 'voice-model', apiKey: 'secret', instructions: 'x', protocol: 'legacy' }, { onStatus: vi.fn(), onTranscript: vi.fn(), onAudio: vi.fn(), onError: vi.fn() })
    socket.readyState = 1; socket.onopen?.(); await started
    expect(JSON.parse(socket.sent[0])).toMatchObject({ session: { input_audio_format: 'pcm16', turn_detection: { type: 'server_vad' } } })
  })

  it('rejects when the socket closes before opening', async () => {
    const socket = new FakeSocket(); const service = new RealtimeVoiceService(() => socket)
    const started = service.start({ baseUrl: 'https://example.com/v1', model: 'voice-model', apiKey: 'secret', instructions: 'x' }, { onStatus: vi.fn(), onTranscript: vi.fn(), onAudio: vi.fn(), onError: vi.fn() })
    socket.onclose?.()
    await expect(started).rejects.toThrow('closed before')
  })
})
