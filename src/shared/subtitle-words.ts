export interface SubtitleToken {
  text: string
  clickable: boolean
}

// Keep dictionary-style compounds intact so one click looks up the whole term.
const wordPattern = /[A-Za-z]+(?:['’-][A-Za-z]+|-[A-Za-z0-9]+)*/g

export function subtitleWordTokens(text: string): SubtitleToken[] {
  const tokens: SubtitleToken[] = []
  let lastIndex = 0

  for (const match of text.matchAll(wordPattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) tokens.push({ text: text.slice(lastIndex, index), clickable: false })
    tokens.push({ text: match[0], clickable: true })
    lastIndex = index + match[0].length
  }

  if (lastIndex < text.length) tokens.push({ text: text.slice(lastIndex), clickable: false })
  return tokens
}
