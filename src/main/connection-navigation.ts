type NavigableWebContents = {
  loadURL(url: string): Promise<unknown>
}

export type WebPracticeSource = 'chatgpt-web'

export function isAbortedNavigationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_ABORTED'
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
  try {
    const host = new URL(url).hostname
    return source === 'chatgpt-web' && (host === 'chatgpt.com' || host === 'auth.openai.com')
  } catch {
    return false
  }
}
