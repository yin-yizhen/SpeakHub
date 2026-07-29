import { describe, expect, it, vi } from 'vitest'
import { checkAliyunConnection, checkLlmConnection } from './provider-connection-check'

describe('LLM connection check', () => {
  it('sends a minimal chat completion request with the current form values', async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => Response.json({ choices: [{ message: { content: 'OK' } }] }))

    await expect(checkLlmConnection({
      llmBaseUrl: 'https://api.example.com/v1',
      llmModel: 'example-chat',
      llmApiKey: ' current-key '
    }, 'saved-key', fetcher)).resolves.toEqual({ ok: true, message: '连接成功，模型可以正常回复。' })

    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe('https://api.example.com/v1/chat/completions')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer current-key' }
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'example-chat',
      stream: false,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with OK only.' }]
    })
  })

  it('reuses a saved key when the password field is empty', async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => Response.json({ choices: [{ message: { content: 'OK' } }] }))
    await checkLlmConnection({ llmBaseUrl: 'https://api.example.com/v1', llmModel: 'example-chat' }, 'saved-key', fetcher)
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Bearer saved-key' })
  })

  it.each([
    [401, '鉴权失败'],
    [403, '鉴权失败'],
    [404, '接口或模型不存在'],
    [429, '余额、额度']
  ])('returns an actionable message for HTTP %i', async (status, message) => {
    await expect(checkLlmConnection(
      { llmBaseUrl: 'https://api.example.com/v1', llmModel: 'example-chat', llmApiKey: 'key' },
      undefined,
      async () => new Response('', { status })
    )).rejects.toThrow(message)
  })

  it('accepts a reasoning model response whose small output budget leaves final content empty', async () => {
    await expect(checkLlmConnection(
      { llmBaseUrl: 'https://api.example.com/v1', llmModel: 'example-chat', llmApiKey: 'key' },
      undefined,
      async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'The model used the short budget while reasoning.' } }] })
    )).resolves.toEqual({ ok: true, message: '连接成功，模型可以正常回复。' })
  })

  it('rejects a response without the Chat Completions message envelope', async () => {
    await expect(checkLlmConnection(
      { llmBaseUrl: 'https://api.example.com/v1', llmModel: 'example-chat', llmApiKey: 'key' },
      undefined,
      async () => Response.json({ choices: [] })
    )).rejects.toThrow('标准的 Chat Completions')
  })

  it('reports timeouts and missing configuration in Chinese', async () => {
    await expect(checkLlmConnection(
      { llmBaseUrl: 'https://api.example.com/v1', llmModel: 'example-chat', llmApiKey: 'key' },
      undefined,
      async () => { throw new DOMException('timed out', 'TimeoutError') }
    )).rejects.toThrow('连接超时')
    await expect(checkLlmConnection({ llmBaseUrl: '', llmModel: '', llmApiKey: '' })).rejects.toThrow('Base URL')
  })

  it('keeps network failures actionable without exposing credentials', async () => {
    await expect(checkLlmConnection(
      { llmBaseUrl: 'https://api.example.com/v1', llmModel: 'example-chat', llmApiKey: 'never-show-this-key' },
      undefined,
      async () => { throw new TypeError('fetch failed') }
    )).rejects.toThrow('无法连接大模型：fetch failed')
  })
})

describe('Aliyun connection check', () => {
  it('starts and immediately stops a recognizer with the current key', async () => {
    const recognizer = { onError: vi.fn(), start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) }
    const factory = vi.fn(() => recognizer)

    await expect(checkAliyunConnection(' current-key ', 'saved-key', factory)).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining('不测试麦克风或扬声器')
    })

    expect(factory).toHaveBeenCalledWith('current-key')
    expect(recognizer.start).toHaveBeenCalledOnce()
    expect(recognizer.stop).toHaveBeenCalledOnce()
  })

  it('reuses the saved key and stops after authentication failure', async () => {
    const recognizer = {
      onError: vi.fn(),
      start: vi.fn(async () => { throw new Error('Authentication failed: invalid api key') }),
      stop: vi.fn(async () => undefined)
    }
    const factory = vi.fn(() => recognizer)

    await expect(checkAliyunConnection(undefined, 'saved-key', factory)).rejects.toThrow('鉴权失败')
    expect(factory).toHaveBeenCalledWith('saved-key')
    expect(recognizer.stop).toHaveBeenCalledOnce()
  })

  it('reports missing keys and connection timeouts', async () => {
    await expect(checkAliyunConnection()).rejects.toThrow('DashScope API Key')
    const recognizer = {
      onError: vi.fn(),
      start: vi.fn(async () => { throw new Error('阿里云语音识别连接超时。') }),
      stop: vi.fn(async () => undefined)
    }
    await expect(checkAliyunConnection('key', undefined, () => recognizer)).rejects.toThrow('连接超时')
    expect(recognizer.stop).toHaveBeenCalledOnce()
  })
})
