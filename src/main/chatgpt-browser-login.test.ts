import { describe, expect, it } from 'vitest'
import {
  browserExecutableCandidates,
  browserLaunchArguments,
  hasCompletedChatGptLogin,
  hasChatGptSessionCookie,
  isChatGptCookieDomain,
  selectChatGptCookiesForImport,
  toElectronCookie,
  type ChromeCookie
} from './chatgpt-browser-login'

const sessionCookie: ChromeCookie = {
  name: '__Secure-next-auth.session-token.0',
  value: 'test-session-value',
  domain: '.chatgpt.com',
  path: '/',
  expires: 1_800_000_000,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax'
}

describe('one-time ChatGPT browser login handoff', () => {
  it('accepts only ChatGPT cookie domains', () => {
    expect(isChatGptCookieDomain('chatgpt.com')).toBe(true)
    expect(isChatGptCookieDomain('.chatgpt.com')).toBe(true)
    expect(isChatGptCookieDomain('auth.chatgpt.com')).toBe(true)
    expect(isChatGptCookieDomain('chatgpt.com.example.com')).toBe(false)
    expect(isChatGptCookieDomain('notchatgpt.com')).toBe(false)
  })

  it('detects both supported Auth.js session-cookie names', () => {
    expect(hasChatGptSessionCookie([sessionCookie])).toBe(true)
    expect(hasChatGptSessionCookie([{ ...sessionCookie, name: '__Secure-authjs.session-token' }])).toBe(true)
    expect(hasChatGptSessionCookie([{ ...sessionCookie, name: '_account' }])).toBe(false)
    expect(hasChatGptSessionCookie([{ ...sessionCookie, domain: '.example.com' }])).toBe(false)
  })

  it('does not accept stale cookies while the browser is still in the login flow', () => {
    expect(hasCompletedChatGptLogin([{ type: 'page', url: 'https://chatgpt.com/auth/login' }])).toBe(false)
    expect(hasCompletedChatGptLogin([{ type: 'page', url: 'https://auth.openai.com/log-in' }])).toBe(false)
    expect(hasCompletedChatGptLogin([
      { type: 'page', url: 'https://chatgpt.com/' },
      { type: 'page', url: 'https://accounts.google.com/o/oauth2/v2/auth' }
    ])).toBe(false)
  })

  it('accepts cookies only after the browser reaches a signed-in ChatGPT page', () => {
    expect(hasCompletedChatGptLogin([{ type: 'page', url: 'https://chatgpt.com/' }])).toBe(true)
    expect(hasCompletedChatGptLogin([{ type: 'page', url: 'https://chatgpt.com/c/example' }])).toBe(true)
    expect(hasCompletedChatGptLogin([{ type: 'service_worker', url: 'https://chatgpt.com/' }])).toBe(false)
  })

  it('imports only secure ChatGPT cookies and prefers an unpartitioned duplicate', () => {
    const partitioned = { ...sessionCookie, value: 'partitioned', partitionKey: { topLevelSite: 'https://example.com' } }
    const insecure = { ...sessionCookie, name: 'optional', secure: false }

    expect(selectChatGptCookiesForImport([
      partitioned,
      insecure,
      sessionCookie,
      { ...sessionCookie, name: 'unrelated', domain: '.example.com' }
    ])).toEqual([sessionCookie])
  })

  it('maps a Chrome HttpOnly cookie into Electron without changing its lifetime', () => {
    expect(toElectronCookie(sessionCookie)).toEqual({
      url: 'https://chatgpt.com/',
      name: sessionCookie.name,
      value: sessionCookie.value,
      domain: '.chatgpt.com',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: 1_800_000_000,
      sameSite: 'lax'
    })
  })

  it('keeps __Host cookies host-only with a root path', () => {
    expect(toElectronCookie({
      ...sessionCookie,
      name: '__Host-next-auth.csrf-token',
      domain: 'chatgpt.com',
      path: '/auth/callback'
    })).toEqual({
      url: 'https://chatgpt.com/',
      name: '__Host-next-auth.csrf-token',
      value: sessionCookie.value,
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: 1_800_000_000,
      sameSite: 'lax'
    })
  })

  it('discovers Chrome and Edge only from Windows application roots', () => {
    expect(browserExecutableCandidates({
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)'
    })).toEqual([
      'C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\test\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ])
  })

  it('reuses the caller-owned dedicated browser profile', () => {
    expect(browserLaunchArguments('C:\\SpeakHub\\chatgpt-login-browser', 32145)).toEqual([
      '--remote-debugging-port=32145',
      '--user-data-dir=C:\\SpeakHub\\chatgpt-login-browser',
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      'https://chatgpt.com/auth/login'
    ])
  })
})
