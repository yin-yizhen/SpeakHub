import { describe, expect, it, vi } from 'vitest'
import { discoverProviderModels } from './provider-model-probe'

describe('discoverProviderModels', () => {
  it('requests the OpenAI-compatible models endpoint and returns sorted ids', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'z-model' }, { id: 'a-model' }, { id: 'a-model' }] }), { status: 200 }))
    await expect(discoverProviderModels('https://api.example.com/v1/', ' secret ', fetcher)).resolves.toEqual(['a-model', 'z-model'])
    expect(fetcher).toHaveBeenCalledWith('https://api.example.com/v1/models', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }))
  })

  it('reports an actionable error for an unavailable endpoint', async () => {
    await expect(discoverProviderModels('https://api.example.com/v1', 'secret', async () => new Response('', { status: 401 }))).rejects.toThrow('HTTP 401')
  })
})
