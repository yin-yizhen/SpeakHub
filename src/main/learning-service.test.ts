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
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ topic: 'travel', summary: 'summary', issues: [], vocabulary: [{ term: 'persistent', meaning: '坚持的' }, { term: 'extra', meaning: '不应保留' }], nextPractice: 'next time' }) } }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'review-model', hasLlmKey: true }, { llmApiKey: 'secret' }))

    await expect(service.review('# Speaking practice\n\n## Transcript\n\nMe: I keep practicing.', 'normal', ['persistent'])).resolves.toMatchObject({ vocabulary: [{ term: 'persistent' }] })
    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    expect(JSON.parse(String(request.body)).messages[0].content).toContain('Practice archive Markdown:\n# Speaking practice')
  })
})

describe('lookup response boundary', () => {
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
})
