import { describe, expect, it, vi } from 'vitest'
import { isAbortedNavigationError, isCurrentConnectionPage, loadConnectionUrl } from './connection-navigation'

describe('connection page navigation', () => {
  it('ignores Electron navigation cancellations caused by a newer request', async () => {
    const loadURL = vi.fn().mockRejectedValue({ code: 'ERR_ABORTED' })

    await expect(loadConnectionUrl({ loadURL }, 'https://chatgpt.com/')).resolves.toBeUndefined()
    expect(loadURL).toHaveBeenCalledWith('https://chatgpt.com/')
    expect(isAbortedNavigationError({ code: 'ERR_ABORTED' })).toBe(true)
  })

  it('keeps real page-load failures visible to the caller', async () => {
    const error = new Error('ERR_NAME_NOT_RESOLVED')

    await expect(loadConnectionUrl({ loadURL: vi.fn().mockRejectedValue(error) }, 'https://chatgpt.com/')).rejects.toBe(error)
  })

  it('keeps the already-open provider page instead of reloading it', () => {
    expect(isCurrentConnectionPage('https://chatgpt.com/c/example', 'chatgpt-web')).toBe(true)
    expect(isCurrentConnectionPage('https://auth.openai.com/log-in', 'chatgpt-web')).toBe(true)
    expect(isCurrentConnectionPage('https://example.com/', 'chatgpt-web')).toBe(false)
  })
})
