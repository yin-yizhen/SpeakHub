import { AliyunFunAsr } from './aliyun-fun-asr'
import type { ProviderConnectionCheckResult } from '../shared/types'

type ConnectionFetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>
type Recognizer = Pick<AliyunFunAsr, 'onError' | 'start' | 'stop'>
type RecognizerFactory = (apiKey: string) => Recognizer

class ConnectionCheckError extends Error {}

function required(value: string | undefined, message: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new ConnectionCheckError(message)
  return normalized
}

function chatCompletionsUrl(baseUrl: string): URL {
  let url: URL
  try {
    url = new URL('chat/completions', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  } catch {
    throw new ConnectionCheckError('Base URL 格式不正确，请填写完整的 http:// 或 https:// 地址。')
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new ConnectionCheckError('Base URL 必须以 http:// 或 https:// 开头。')
  return url
}

function llmStatusError(status: number): ConnectionCheckError {
  if (status === 401 || status === 403) return new ConnectionCheckError(`大模型鉴权失败（HTTP ${status}），请检查 API Key 和账号权限。`)
  if (status === 404) return new ConnectionCheckError('大模型接口或模型不存在（HTTP 404），请检查 Base URL 和模型名。')
  if (status === 429) return new ConnectionCheckError('大模型当前不可用（HTTP 429），请检查余额、额度或稍后重试。')
  return new ConnectionCheckError(`大模型连接失败（HTTP ${status}），请检查服务状态和接口配置。`)
}

function llmFailure(error: unknown): Error {
  if (error instanceof ConnectionCheckError) return error
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ConnectionCheckError('大模型连接超时，请检查网络、Base URL 或服务状态。')
  }
  return new ConnectionCheckError(`无法连接大模型：${error instanceof Error ? error.message : String(error)}`)
}

export async function checkLlmConnection(
  input: { llmBaseUrl?: string; llmModel?: string; llmApiKey?: string },
  savedApiKey?: string,
  fetcher: ConnectionFetch = fetch
): Promise<ProviderConnectionCheckResult> {
  try {
    const baseUrl = required(input.llmBaseUrl, '请填写大模型 Base URL。')
    const model = required(input.llmModel, '请填写要检测的模型名。')
    const apiKey = required(input.llmApiKey?.trim() || savedApiKey, '请填写 API Key，或先保存一个 API Key。')
    const response = await fetcher(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        stream: false,
        max_tokens: 8
      }),
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw llmStatusError(response.status)
    let payload: { choices?: Array<{ message?: unknown }> }
    try {
      payload = await response.json() as typeof payload
    } catch {
      throw new ConnectionCheckError('大模型接口已响应，但返回内容不是有效 JSON。')
    }
    const message = payload.choices?.[0]?.message
    if (!message || typeof message !== 'object') {
      throw new ConnectionCheckError('大模型接口已响应，但没有返回标准的 Chat Completions 消息结构。')
    }
    return { ok: true, message: '连接成功，模型可以正常回复。' }
  } catch (error) {
    throw llmFailure(error)
  }
}

function aliyunFailure(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/超时|timeout/i.test(message)) return new ConnectionCheckError('阿里识别连接超时，请检查网络或稍后重试。')
  if (/(401|403|unauthori[sz]ed|forbidden|authentication|api.?key|invalid.*key|access.?denied)/i.test(message)) {
    return new ConnectionCheckError('阿里识别鉴权失败，请检查 DashScope API Key、业务空间和服务权限。')
  }
  return new ConnectionCheckError(`阿里识别连接失败：${message}`)
}

export async function checkAliyunConnection(
  inputApiKey?: string,
  savedApiKey?: string,
  recognizerFactory: RecognizerFactory = (apiKey) => new AliyunFunAsr(apiKey)
): Promise<ProviderConnectionCheckResult> {
  const apiKey = required(inputApiKey?.trim() || savedApiKey, '请填写阿里 DashScope API Key，或先保存一个 Key。')
  const recognizer = recognizerFactory(apiKey)
  recognizer.onError(() => undefined)
  try {
    await recognizer.start()
    return { ok: true, message: '阿里识别连接成功，Key 和网络可用；此检测不测试麦克风或扬声器。' }
  } catch (error) {
    throw aliyunFailure(error)
  } finally {
    await recognizer.stop().catch(() => undefined)
  }
}
