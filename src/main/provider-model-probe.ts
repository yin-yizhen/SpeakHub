export type ModelFetch = (input: string, init: RequestInit) => Promise<Response>

function modelsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalized)) throw new Error('Base URL 必须以 http:// 或 https:// 开头。')
  return normalized.endsWith('/models') ? normalized : `${normalized}/models`
}

export async function discoverProviderModels(baseUrl: string, apiKey: string, fetcher: ModelFetch = fetch): Promise<string[]> {
  if (!apiKey.trim()) throw new Error('请填写 API Key，或先保存一个 API Key。')
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetcher(modelsUrl(baseUrl), { headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) throw new Error(`模型探测失败（HTTP ${response.status}）。请检查 Base URL 和 API Key。`)
    const body: unknown = await response.json()
    const entries = Array.isArray(body) ? body : typeof body === 'object' && body ? (Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data : Array.isArray((body as { models?: unknown }).models) ? (body as { models: unknown[] }).models : []) : []
    const models = entries.flatMap((item) => typeof item === 'string' ? [item] : typeof item === 'object' && item && typeof (item as { id?: unknown }).id === 'string' ? [(item as { id: string }).id] : [])
    const unique = [...new Set(models.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    if (!unique.length) throw new Error('接口响应中没有可选择的模型。')
    return unique
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('模型探测超时，请检查接口地址和网络。')
    throw error
  } finally { clearTimeout(timeout) }
}
