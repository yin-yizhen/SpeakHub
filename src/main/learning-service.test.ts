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
    const schema = z.object({ topic: z.string(), issues: z.array(z.object({ original: z.string() })) })
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

  it('omits the generated ChatGPT setup prompt but keeps later learner turns', async () => {
    const response = { topic: 'interview', summary: 'summary', issues: [], vocabulary: [], nextPractice: 'next time' }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'review-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as unknown as typeof fetch)
    const archive = `---\nsource: chatgpt-web\n---\n\n<!-- speaksub-session:YWJj -->\n\n# Speaking practice\n\n## Transcript\n\n### Me at 2026-08-09T11:36:13.981Z\n\nGENERATED_SETUP_PROMPT\n\n### AI at 2026-08-09T11:36:15.444Z\n\nTell me about yourself.\n\n### Me at 2026-08-09T11:36:23.250Z\n\nI am a graduate student.\n\n## Review\n\nOLD_INCORRECT_REVIEW`

    await service.review(archive, 'normal')

    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    const prompt = JSON.parse(String(request.body)).messages[0].content as string
    expect(prompt).not.toContain('GENERATED_SETUP_PROMPT')
    expect(prompt).not.toContain('speaksub-session:YWJj')
    expect(prompt).not.toContain('OLD_INCORRECT_REVIEW')
    expect(prompt).toContain('I am a graduate student.')
    expect(prompt).toContain('Correct only learner language')
  })

  it('keeps the first learner turn for API direct archives', async () => {
    const response = { topic: 'interview', summary: 'summary', issues: [], vocabulary: [], nextPractice: 'next time' }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'review-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as unknown as typeof fetch)
    const archive = `---\nsource: api-direct\n---\n\n## Transcript\n\n### Me at 2026-08-09T11:36:23.250Z\n\nFIRST_REAL_API_ANSWER`

    await service.review(archive, 'normal')

    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    expect(JSON.parse(String(request.body)).messages[0].content).toContain('FIRST_REAL_API_ANSWER')
  })

  it('keeps a sparse one-hour transcript in one complete request', async () => {
    const response = { topic: 'daily', summary: 'summary', issues: [], vocabulary: [], nextPractice: 'next time' }
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'review-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as unknown as typeof fetch)
    const archive = `---\nstartedAt: 2026-08-15T00:00:00.000Z\nendedAt: 2026-08-15T01:00:00.000Z\nsource: api-direct\n---\n\n## Transcript\n\n### Me at 2026-08-15T00:01:00.000Z\n\nFIRST_SPARSE_TURN\n\n### AI at 2026-08-15T00:30:00.000Z\n\nA short reply.\n\n### Me at 2026-08-15T00:59:00.000Z\n\nLAST_SPARSE_TURN`

    await service.review(archive, 'normal')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    const prompt = JSON.parse(String(request.body)).messages[0].content as string
    expect(prompt).toContain('FIRST_SPARSE_TURN')
    expect(prompt).toContain('LAST_SPARSE_TURN')
  })

  it('uses the review-specific timeout and translates a body timeout into a recoverable message', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) }
    }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'review-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as unknown as typeof fetch)

    await expect(service.review('# Speaking practice', 'normal')).rejects.toThrow('300 秒')
  })

  it('streams one complete request for a long transcript when the provider can handle it', async () => {
    const review = JSON.stringify({ topic: 'overall', summary: '完整总评', issues: [{ original: 'wrong', improved: 'right', reason: 'reason' }], vocabulary: [], nextPractice: 'next time' })
    const midpoint = Math.floor(review.length / 2)
    const sse = [review.slice(0, midpoint), review.slice(midpoint)].map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const longTurn = (marker: string) => `### Me at 2026-08-15T00:00:00.000Z\n\n${marker} ${'learner words '.repeat(280)}`
    const archive = `---\nsource: api-direct\n---\n\n## Transcript\n\n${longTurn('FIRST_LONG_SEGMENT')}\n\n${longTurn('SECOND_LONG_SEGMENT')}\n\n${longTurn('THIRD_LONG_SEGMENT')}`
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'review-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as unknown as typeof fetch)

    await expect(service.review(archive, 'normal')).resolves.toMatchObject({ topic: 'overall', issues: [{ original: 'wrong' }] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    const body = JSON.parse(String(request.body)) as { stream: boolean; messages: Array<{ content: string }> }
    expect(body.stream).toBe(true)
    expect(body.messages[0].content).toContain('FIRST_LONG_SEGMENT')
    expect(body.messages[0].content).toContain('THIRD_LONG_SEGMENT')
  })

  it('splits a long transcript, retries a gateway-timed-out segment at a smaller boundary, and merges every correction locally', async () => {
    const analysis = { translation: '慢慢来。', structure: '祈使句', reusablePattern: 'Take your time to + 动词', expressions: [], breakdown: [], examples: ['Take your time to think.'] }
    const assessment = { estimatedCefr: 'B1', scores: { accuracy: 72, vocabulary: 68, fluency: 75, interaction: 80 }, errorCategories: [], weakPoints: [] }
    let rejectedFullReview = false
    let rejectedLargeSegment = false
    let continuedSegment = 0
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const prompt = (JSON.parse(String(init?.body)).messages[0].content as string)
      if (prompt.includes('Synthesize the overall review')) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({ topic: 'overall', summary: '完整总评', vocabulary: [{ term: 'persistent', meaning: '坚持的' }, { term: 'extra', meaning: '不应保留' }], nextPractice: '继续练习', assessment, sentenceAnalyses: [{ sourceMessageId: 'sentence-1', analysis }] }) } }] })
      }
      if (!rejectedFullReview && prompt.includes('Analyze this complete practice archive')) {
        rejectedFullReview = true
        return new Response('', { status: 504 })
      }
      if (!rejectedLargeSegment && prompt.includes('Analyze transcript segment') && prompt.includes('RETRY_SEGMENT')) {
        rejectedLargeSegment = true
        return new Response('', { status: 504 })
      }
      let original: string
      if (prompt.includes('RETRY_SEGMENT')) original = 'retry issue'
      else if (prompt.includes('SECOND_SEGMENT')) original = 'second issue'
      else if (prompt.includes('THIRD_SEGMENT')) original = 'third issue'
      else original = `continued issue ${++continuedSegment}`
      const partial = { topic: 'part', summary: 'part summary', issues: [{ original, improved: `${original} fixed`, reason: 'reason' }], vocabulary: [], nextPractice: 'part next', assessment }
      return Response.json({ choices: [{ message: { content: JSON.stringify(partial) } }] })
    })
    const longTurn = (marker: string) => `### Me at 2026-08-15T00:00:00.000Z\n\n${marker} ${'learner words '.repeat(280)}`
    const archive = `---\nsource: api-direct\n---\n\n## Transcript\n\n${longTurn('RETRY_SEGMENT')}\n\n${longTurn('SECOND_SEGMENT')}\n\n${longTurn('THIRD_SEGMENT')}`
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'review-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as unknown as typeof fetch)

    const result = await service.reviewWithSentences(archive, 'normal', ['persistent'], [{ sourceMessageId: 'sentence-1', text: 'Take your time.' }])

    expect(rejectedFullReview).toBe(true)
    expect(rejectedLargeSegment).toBe(true)
    expect(result.review).toMatchObject({ topic: 'overall', vocabulary: [{ term: 'persistent' }] })
    expect(result.review.issues.map((issue) => issue.original)).toEqual(expect.arrayContaining(['retry issue', 'second issue', 'third issue']))
    expect(result.review.issues.length).toBeGreaterThanOrEqual(4)
    expect(result.sentenceAnalyses).toEqual([{ sourceMessageId: 'sentence-1', analysis }])
    const prompts = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>).map(([, request]) => JSON.parse(String(request.body)).messages[0].content as string)
    const synthesisPrompt = prompts.find((prompt) => prompt.includes('Synthesize the overall review'))
    expect(synthesisPrompt).not.toContain('RETRY_SEGMENT')
    expect(synthesisPrompt).toContain('Saved vocabulary:\n- persistent')
    expect(prompts.filter((prompt) => prompt.includes('Analyze transcript segment')).length).toBeGreaterThan(3)
    expect(prompts.filter((prompt) => prompt.includes('Analyze transcript segment')).every((prompt) => !prompt.includes('Saved vocabulary:\n- persistent'))).toBe(true)
  })
})

describe('review with saved sentence analysis boundary', () => {
  it('returns review and all saved sentence analyses from one model request', async () => {
    const analysis = { translation: '慢慢来。', structure: '祈使句', reusablePattern: 'Take your time to + 动词', expressions: [{ phrase: 'take your time', meaning: '慢慢来，不用着急' }], breakdown: [{ part: 'Take your time', explanation: '用于安慰或允许对方从容处理' }], examples: ['Take your time to think about it.'], tip: '不表示占用别人的时间。' }
    const response = { topic: 'travel', summary: 'summary', issues: [], vocabulary: [{ term: 'persistent', meaning: '坚持的' }, { term: 'extra', meaning: '不应保留' }], nextPractice: 'next time', sentenceAnalyses: [{ sourceMessageId: 'sentence-1', analysis }], assessment: { estimatedCefr: 'B1', scores: { accuracy: 72, vocabulary: 68, fluency: 75, interaction: 80 }, errorCategories: [], weakPoints: [] } }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'analysis-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as unknown as typeof fetch)

    await expect(service.reviewWithSentences('# Speaking practice', 'normal', ['persistent'], [{ sourceMessageId: 'sentence-1', text: 'Take your time.' }])).resolves.toMatchObject({ review: { vocabulary: [{ term: 'persistent' }] }, sentenceAnalyses: [{ sourceMessageId: 'sentence-1', analysis }] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    expect(JSON.parse(String(request.body)).messages[0].content).toContain('Saved sentences:\n[{"sourceMessageId":"sentence-1","text":"Take your time."}]')
  })

  it('rejects a combined review that omits a saved sentence analysis', async () => {
    const response = { topic: 'travel', summary: 'summary', issues: [], vocabulary: [], nextPractice: 'next time', sentenceAnalyses: [], assessment: { estimatedCefr: 'B1', scores: { accuracy: 72, vocabulary: 68, fluency: 75, interaction: 80 }, errorCategories: [], weakPoints: [] } }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'analysis-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as unknown as typeof fetch)

    await expect(service.reviewWithSentences('# Speaking practice', 'normal', [], [{ sourceMessageId: 'sentence-1', text: 'Take your time.' }])).rejects.toThrow('句子分析不完整')
  })

  it('preserves every valid correction when a long review returns more than ten issues', async () => {
    const analysis = { translation: '慢慢来。', structure: '祈使句', reusablePattern: 'Take your time to + 动词', expressions: [], breakdown: [], examples: ['Take your time to think.'] }
    const issues = Array.from({ length: 12 }, (_, index) => ({ original: `issue-${index + 1}`, improved: `fixed-${index + 1}`, reason: `reason-${index + 1}` }))
    const response = { topic: 'travel', summary: 'summary', issues, vocabulary: [], nextPractice: 'next time', sentenceAnalyses: [{ sourceMessageId: 'sentence-1', analysis }], assessment: { estimatedCefr: 'B1', scores: { accuracy: 72, vocabulary: 68, fluency: 75, interaction: 80 }, errorCategories: [], weakPoints: [] } }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'analysis-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as unknown as typeof fetch)

    const result = await service.reviewWithSentences('# Speaking practice', 'normal', [], [{ sourceMessageId: 'sentence-1', text: 'Take your time.' }])

    expect(result.review.issues).toHaveLength(12)
    expect(result.review.issues.at(-1)?.original).toBe('issue-12')
    expect(result.sentenceAnalyses).toHaveLength(1)
    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    expect(JSON.parse(String(request.body)).messages[0].content).toContain('do not impose a fixed 8- or 10-item limit')
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
  it('combines an editable system prompt with selected prompts and focus before transcript history', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'What would you like to drink?' } }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'practice-model', hasLlmKey: true }, { llmApiKey: 'secret' }))
    const selectedPrompt = '请扮演咖啡店店员，每次只问一个问题。\n\n本次重点：\n练习过去时。'

    await service.chat([
      { id: 'u1', sessionId: 's1', sourceMessageId: 'u1', speaker: 'user', text: 'Um', status: 'complete', receivedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a1', sessionId: 's1', sourceMessageId: 'a1', speaker: 'assistant', text: 'Take your time.', status: 'complete', receivedAt: '2026-01-01T00:00:01.000Z' }
    ], '日常聊天', 'A1', selectedPrompt, '这是可编辑的系统提示词。')

    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0][1]
    const messages = JSON.parse(String(request.body)).messages as Array<{ role: string; content: string }>
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant'])
    expect(messages[0].content).toContain('这是可编辑的系统提示词。')
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

  it('paces a compatible non-SSE response into multiple subtitle deltas', async () => {
    const content = 'This complete compatibility response should still appear progressively in the subtitle overlay.'
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content } }] }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'practice-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as typeof fetch)
    const snapshots: string[] = []
    let displayed = ''

    await expect(service.streamChat([], 'daily', 'B1', { onDelta: (delta) => { displayed += delta; snapshots.push(displayed) } })).resolves.toBe(content)

    expect(snapshots.length).toBeGreaterThan(1)
    expect(snapshots[0]).not.toBe(content)
    expect(snapshots.at(-1)).toBe(content)
  })

  it('can interrupt while a complete provider response is being paced into subtitle deltas', async () => {
    const content = 'This complete compatibility response is intentionally long enough to require several subtitle updates.'
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content } }] }))
    const service = new LearningService(settings({ llmBaseUrl: 'https://example.com/v1', llmModel: 'practice-model', hasLlmKey: true }, { llmApiKey: 'secret' }), undefined, fetchMock as typeof fetch)
    const controller = new AbortController()
    const deltas: string[] = []

    const request = service.streamChat([], 'daily', 'B1', { signal: controller.signal, onDelta: (delta) => { deltas.push(delta); controller.abort() } })

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).not.toBe(content)
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
