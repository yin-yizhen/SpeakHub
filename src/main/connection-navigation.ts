type NavigableWebContents = {
  loadURL(url: string): Promise<unknown>
}

type ConnectionCookie = {
  domain?: string
  name: string
  path?: string
  secure?: boolean
}

export type WebPracticeSource = 'chatgpt-web'

const CHATGPT_CONNECTION_HOSTS = new Set([
  'chatgpt.com',
  'auth.openai.com',
  'accounts.google.com'
])

const CONNECTION_LOGIN_COOKIE_DOMAINS = [
  'chatgpt.com',
  'openai.com',
  'google.com'
]

export function isAbortedNavigationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_ABORTED'
}

export function chromeCompatibleUserAgent(chromeVersion: string): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
}

export function isAllowedConnectionUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && CHATGPT_CONNECTION_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

export function connectionLoginCookieUrl(cookie: ConnectionCookie): string | undefined {
  const domain = cookie.domain?.trim().replace(/^\./, '').toLowerCase() ?? ''
  const allowed = CONNECTION_LOGIN_COOKIE_DOMAINS.some((root) => domain === root || domain.endsWith(`.${root}`))
  if (!allowed) return undefined
  const path = cookie.path?.startsWith('/') ? cookie.path : '/'
  return `${cookie.secure === false ? 'http' : 'https'}://${domain}${path}`
}

export async function loadConnectionUrl(contents: NavigableWebContents, url: string): Promise<void> {
  try {
    await contents.loadURL(url)
  } catch (error) {
    // Electron rejects the previous load when a new login/navigation request replaces it.
    if (!isAbortedNavigationError(error)) throw error
  }
}

export function isCurrentConnectionPage(url: string, source: WebPracticeSource): boolean {
  return source === 'chatgpt-web' && isAllowedConnectionUrl(url)
}
