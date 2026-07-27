export const SKIPPED_UPDATE_VERSION_KEY = 'speakhub-skipped-update-version-v1'

export function readSkippedUpdateVersion(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(SKIPPED_UPDATE_VERSION_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function writeSkippedUpdateVersion(version: string): void {
  if (typeof window === 'undefined') return
  try {
    const normalized = String(version ?? '').trim()
    if (normalized) window.localStorage.setItem(SKIPPED_UPDATE_VERSION_KEY, normalized)
    else window.localStorage.removeItem(SKIPPED_UPDATE_VERSION_KEY)
  } catch {
    // Update preferences must never prevent the app from opening.
  }
}

export function shouldShowUpdatePrompt(latestVersion: string, skippedVersion: string): boolean {
  const latest = String(latestVersion ?? '').trim()
  return Boolean(latest && latest !== String(skippedVersion ?? '').trim())
}
