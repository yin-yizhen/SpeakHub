import { describe, expect, it, vi } from 'vitest'
import { MimoTtsClient } from './mimo-tts-client'

function pcmBase64(values: number[]): string {
  const buffer = Buffer.alloc(values.length * 2)
  values.forEach((value, index) => buffer.writeInt16LE(value, index * 2))
  return buffer.toString('base64')
}

describe('MimoTtsClient', () => {
  it('delivers audio before SSE ends and joins PCM samples split between events', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'content-type': 'text/event-stream' } })
    const client = new MimoTtsClient({ apiKey: 'secret' }, (async () => response) as typeof fetch)
    const received: number[] = []
    const pending = client.synthesize('Hello.', new AbortController().signal, samples => received.push(...samples))
    const send = (bytes: number[]): void => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { audio: { data: Buffer.from(bytes).toString('base64') } } }] })}\n\n`))
    send([0])
    send([64, 0, 128])
    await vi.waitFor(() => expect(received).toEqual([0.5, -1]))
    stream.close()
    const audio = await pending
    expect([...audio.samples]).toEqual(received)
  })

  it('cancels a stalled SSE reader when interrupted and emits no further audio', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } })
    const client = new MimoTtsClient({ apiKey: 'secret' }, (async () => response) as typeof fetch)
    const controller = new AbortController()
    const onAudio = vi.fn()
    const pending = client.synthesize('Hello.', controller.signal, onAudio)
    await Promise.resolve(); await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(onAudio).not.toHaveBeenCalled()
  })

  it('calls the official streaming endpoint and converts PCM16 chunks to float audio', async () => {
    const first = pcmBase64([0, 16_384])
    const second = pcmBase64([-32_768, 32_767])
    const body = [
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: first } } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: second } } }] })}`,
      'data: [DONE]',
      ''
    ].join('\n\n')
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const client = new MimoTtsClient({ apiKey: 'mimo-secret', voice: 'Milo' }, fetcher as typeof fetch)

    const result = await client.synthesize('Hello there.', new AbortController().signal)

    expect(fetcher).toHaveBeenCalledWith('https://api.xiaomimimo.com/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'api-key': 'mimo-secret' })
    }))
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(request).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [{ role: 'assistant', content: 'Hello there.' }],
      audio: { format: 'pcm16', voice: 'Milo' },
      stream: true
    })
    expect(result.sampleRate).toBe(24000)
    expect([...result.samples]).toEqual([0, 0.5, -1, 32_767 / 32_768])
  })

  it('accepts a non-streaming compatible JSON response', async () => {
    const data = pcmBase64([8_192])
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { audio: { data } } }] }))
    const client = new MimoTtsClient({ apiKey: 'secret' }, fetcher as typeof fetch)

    await expect(client.synthesize('Hello', new AbortController().signal)).resolves.toMatchObject({
      sampleRate: 24000,
      samples: Float32Array.from([0.25])
    })
  })

  it('reports bounded service errors without exposing the API key', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { message: 'invalid credential' } }, { status: 401 }))
    const client = new MimoTtsClient({ apiKey: 'do-not-leak' }, fetcher as typeof fetch)

    await expect(client.synthesize('Hello', new AbortController().signal)).rejects.toThrow('HTTP 401): invalid credential')
    await expect(client.synthesize('Hello', new AbortController().signal)).rejects.not.toThrow('do-not-leak')
  })

  it('turns an aborted request into an AbortError', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      throw new Error('unreachable')
    })
    const client = new MimoTtsClient({ apiKey: 'secret' }, fetcher as typeof fetch)
    const controller = new AbortController()
    const pending = client.synthesize('Hello', controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
