import type { Speaker, SubtitleMode, TranscriptEvent } from './types'

export function mergeTranscriptEvent(events: TranscriptEvent[], incoming: TranscriptEvent): TranscriptEvent[] {
  const existingIndex = events.findIndex((event) => event.sourceMessageId === incoming.sourceMessageId)
  if (existingIndex === -1) return [...events, incoming]
  const next = [...events]
  next[existingIndex] = { ...next[existingIndex], ...incoming, id: next[existingIndex].id }
  return next
}

export function visualLineCount(text: string, charactersPerLine = 54): number {
  const weightedCharacters = [...text].reduce((total, character) => total + (/[^\x00-\x7F]/.test(character) ? 1 : 0.55), 0)
  return Math.max(1, Math.ceil(weightedCharacters / charactersPerLine))
}

export function subtitleEvents(events: TranscriptEvent[], mode: SubtitleMode, maxLines: number, charactersPerLine = 54): TranscriptEvent[] {
  const accepted = events.filter((event) => mode === 'both' || event.speaker === mode)
  const selected: TranscriptEvent[] = []
  let visualLines = 0
  for (const event of [...accepted].reverse()) {
    const lines = visualLineCount(event.text, charactersPerLine)
    if (selected.length && visualLines + lines > maxLines) break
    selected.unshift(event)
    visualLines += lines
  }
  return selected
}

export function normalizeSpeaker(value: string): Speaker | undefined {
  if (value === 'assistant') return 'assistant'
  if (value === 'user') return 'user'
  return undefined
}
