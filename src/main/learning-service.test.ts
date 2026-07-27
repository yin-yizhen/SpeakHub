import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { LearningService } from './learning-service'
import type { SecureSettings } from './secure-settings'

function settings(config: ReturnType<SecureSettings['get']>, secrets: ReturnType<SecureSettings['getSecrets']> = {}): SecureSettings {
  return { get: () => config, getSecrets: () => secrets } as unknown as SecureSettings
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('review response boundary', () => {
  it('rejects malformed review JSON', () => {
    const schema = z.object({ topic: z.string(), issues: z.array(z.object({ original: z.string() })).max(8) })
    expect(() => schema.parse({ topic: 'travel', issues: [{ original: 2 }] })).toThrow()
  })

  it('asks the model to explain only the saved vocabulary', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ topic: 'travel', summary: 'summary', issues: [], vocabulary: [{ term: 'persistent', meaning: '坚持的' }, { term: 'extra', meaning: '不应保留' }], nextPractice: 'next time', assessment: { estimatedCefr: 'B1', scores: { accuracy: 72, vocabulary: 68, fluency: 75, interaction: 80 }, errorCategories: [{ category: 'tense', count: 2 }], weakPoints: ['past tense'] } }) } }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'review-model', hasLlmKey: true }, { llmApiKey: 'secret' }))

    await expect(service.review('# Speaking practice\n\n## Transcript\n\nMe: I keep practicing.', 'normal', ['persistent'])).resolves.toMatchObject({ vocabulary: [{ term: 'persistent' }], assessment: { estimatedCefr: 'B1', scores: { accuracy: 72 } } })
    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    expect(JSON.parse(String(request.body)).messages[0].content).toContain('Practice archive Markdown:\n# Speaking practice')
  })
})

describe('lookup response boundary', () => {
  it('exposes built-in dictionary results for persisted vocabulary backfill without network fallback', () => {
    const service = new LearningService(settings({ hasLlmKey: false }), 'resources/dictionaries/ecdict-en-zh')

    expect(service.lookupLocal('word')).toMatchObject({ query: 'word', definitions: expect.any(Array) })
  })

  it('uses the built-in dictionary without provider credentials', async () => {
    const service = new LearningService(settings({ hasLlmKey: false }), 'resources/dictionaries/ecdict-en-zh')

    await expect(service.lookup('word')).resolves.toMatchObject({
      query: 'word',
      definitions: expect.arrayContaining([expect.stringContaining('词')])
    })
  })

  it('returns a local definition without calling a rate-limited LLM fallback', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'lookup-model', hasLlmKey: true }, { llmApiKey: 'secret' }), 'resources/dictionaries/ecdict-en-zh')

    await expect(service.lookup('today')).resolves.toMatchObject({ query: 'today', definitions: expect.any(Array) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects lookup when no provider is configured and the built-in dictionary misses', async () => {
    const service = new LearningService(settings({ hasLlmKey: false }))

    await expect(service.lookup('notarealwordzz')).rejects.toThrow()
  })
})

describe('OpenAI-compatible direct chat', () => {
  it('combines the fixed English-first system rules with selected prompts and focus before transcript history', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'What would you like to drink?' } }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'practice-model', hasLlmKey: true }, { llmApiKey: 'secret' }))
    const selectedPrompt = '请扮演咖啡店店员，每次只问一个问题。\n\n本次重点：\n练习过去时。'

    await service.chat([
      { id: 'u1', sessionId: 's1', sourceMessageId: 'u1', speaker: 'user', text: 'Um', status: 'complete', receivedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a1', sessionId: 's1', sourceMessageId: 'a1', speaker: 'assistant', text: 'Take your time.', status: 'complete', receivedAt: '2026-01-01T00:00:01.000Z' }
    ], '日常聊天', 'A1', selectedPrompt)

    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    const messages = JSON.parse(String(request.body)).messages as Array<{ role: string; content: string }>
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant'])
    expect(messages[0].content).toContain('英文内容应占回复的至少 80%')
    expect(messages[0].content).toContain('语气词、孤立单词、不完整句子')
    expect(messages[0].content).toContain('请扮演咖啡店店员')
    expect(messages[0].content).toContain('本次重点：\n练习过去时。')
  })

  it('sends transcript turns and returns assistant content', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Tell me about your last trip.' } }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'practice-model', hasLlmKey: true }, { llmApiKey: 'secret' }))

    await expect(service.chat([{ id: 'u1', sessionId: 's1', sourceMessageId: 'u1', speaker: 'user', text: 'I like Japan.', status: 'complete', receivedAt: '2026-01-01T00:00:00.000Z' }], 'travel', 'B1')).resolves.toBe('Tell me about your last trip.')
    expect(fetchMock).toHaveBeenCalledWith(new URL('chat/completions', 'https://example.com/v1/'), expect.objectContaining({ method: 'POST' }))
    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    expect(JSON.parse(String(request.body))).toMatchObject({ model: 'practice-model', messages: [expect.objectContaining({ role: 'system' }), { role: 'user', content: 'I like Japan.' }] })
  })

  it('rejects direct chat when API configuration is incomplete', async () => {
    const service = new LearningService(settings({ hasLlmKey: false }))
    await expect(service.chat([], 'daily chat', 'B1')).rejects.toThrow('OpenAI-compatible')
  })

  it('parses arbitrarily chunked SSE deltas including mixed Chinese and English', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"con',
      'tent":"你好，"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world!"}}]}\r\n\r\n',
      'data: [DONE]\n\n'
    ]
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close() }
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'practice-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as typeof fetch)
    const deltas: string[] = []

    await expect(service.streamChat([], 'daily', 'B1', { onDelta: (delta) => deltas.push(delta) })).resolves.toBe('你好，world!')
    expect(deltas).toEqual(['你好，', 'world!'])
    expect(JSON.parse(String((fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1].body))).toMatchObject({ stream: true })
  })

  it('falls back once to a normal response when streaming is rejected before any delta', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '整段回退回复' } }] }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'practice-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as typeof fetch)
    const deltas: string[] = []

    await expect(service.streamChat([], 'daily', 'B1', { onDelta: (delta) => deltas.push(delta) })).resolves.toBe('整段回退回复')
    expect(deltas).toEqual(['整段回退回复'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String((fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[1][1].body))).not.toHaveProperty('stream')
  })

  it('honors active cancellation', async () => {
    const fetchMock = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'practice-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as typeof fetch)
    const controller = new AbortController()
    const request = service.streamChat([], 'daily', 'B1', { onDelta: () => undefined, signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })
})
