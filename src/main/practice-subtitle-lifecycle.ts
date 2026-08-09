export type SubtitleVisibilityErrorHandler = (error: unknown) => void

function applyVisibility(action: () => void, onError?: SubtitleVisibilityErrorHandler): void {
  try { action() }
  catch (error) { onError?.(error) }
}

export async function startPracticeWithSubtitles<T>(
  start: () => Promise<T>,
  showSubtitles: () => void,
  onVisibilityError?: SubtitleVisibilityErrorHandler
): Promise<T> {
  const result = await start()
  applyVisibility(showSubtitles, onVisibilityError)
  return result
}

export async function endPracticeWithSubtitles<T>(
  end: () => Promise<T>,
  hideSubtitles: () => void,
  onVisibilityError?: SubtitleVisibilityErrorHandler
): Promise<T> {
  applyVisibility(hideSubtitles, onVisibilityError)
  return end()
}
