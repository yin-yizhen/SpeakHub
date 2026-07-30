import { describe, expect, it, vi } from 'vitest'
import {
  chromeCompatibleUserAgent,
  connectionLoginCookieUrl,
  isAbortedNavigationError,
  isAllowedConnectionUrl,
  isCurrentConnectionPage,
  loadConnectionUrl
} from './connection-navigation'

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
    expect(isCurrentConnectionPage('https://accounts.google.com/o/oauth2/v2/auth', 'chatgpt-web')).toBe(true)
    expect(isCurrentConnectionPage('https://example.com/', 'chatgpt-web')).toBe(false)
  })

  it('allows only the exact HTTPS hosts required by ChatGPT and Google sign-in', () => {
    expect(isAllowedConnectionUrl('https://chatgpt.com/')).toBe(true)
    expect(isAllowedConnectionUrl('https://auth.openai.com/oauth/callback')).toBe(true)
    expect(isAllowedConnectionUrl('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true)
    expect(isAllowedConnectionUrl('http://accounts.google.com/o/oauth2/v2/auth')).toBe(false)
    expect(isAllowedConnectionUrl('https://accounts.google.com.example.com/')).toBe(false)
    expect(isAllowedConnectionUrl('https://example.com/')).toBe(false)
  })

  it('uses a Chrome-compatible Windows user agent without exposing Electron', () => {
    const userAgent = chromeCompatibleUserAgent('140.0.7339.249')

    expect(userAgent).toContain('Chrome/140.0.7339.249')
    expect(userAgent).toContain('Windows NT 10.0; Win64; x64')
    expect(userAgent).not.toContain('Electron')
  })

  it('targets only Google, OpenAI, and ChatGPT cookies in the embedded partition', () => {
    expect(connectionLoginCookieUrl({ domain: '.google.com', name: 'SID', path: '/', secure: true })).toBe('https://google.com/')
    expect(connectionLoginCookieUrl({ domain: 'accounts.google.com', name: 'ACCOUNT', path: '/oauth2', secure: true })).toBe('https://accounts.google.com/oauth2')
    expect(connectionLoginCookieUrl({ domain: '.auth.openai.com', name: 'session', secure: true })).toBe('https://auth.openai.com/')
    expect(connectionLoginCookieUrl({ domain: '.chatgpt.com', name: 'session', secure: true })).toBe('https://chatgpt.com/')
    expect(connectionLoginCookieUrl({ domain: '.example.com', name: 'unrelated', secure: true })).toBeUndefined()
    expect(connectionLoginCookieUrl({ domain: '.notgoogle.com', name: 'unrelated', secure: true })).toBeUndefined()
  })
})
