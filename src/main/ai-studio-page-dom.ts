/** Observed AI Studio Live DOM, 2026-10-15. Self-contained for page execution. */
export function readAIStudioSnapshot(root: ParentNode): {
  rows: Array<{ sourceMessageId: string; speaker: 'user' | 'assistant'; text: string; status: 'streaming' | 'complete' }>
  emptyUserTurns: number
  turnCount: number
} {
  const turns = [...root.querySelectorAll<HTMLElement>('ms-bidi-turn')]
  const rows: Array<{ sourceMessageId: string; speaker: 'user' | 'assistant'; text: string; status: 'streaming' | 'complete' }> = []
  let emptyUserTurns = 0
  turns.forEach((turn, index) => {
    const content = turn.querySelector<HTMLElement>('.turn.user, .turn.model')
    if (!content) return
    const speaker = content.classList.contains('user') ? 'user' : 'assistant'
    const parts = [...content.querySelectorAll<HTMLElement>('ms-bidi-text-part, ms-bidi-audio-part .transcript, ms-bidi-audio-stream-part .transcript')]
      .map(part => (part.innerText ?? part.textContent ?? '').trim()).filter(Boolean)
    const text = [...new Set(parts)].join('\n\n')
    if (!text) {
      // A current recording placeholder is expected. An empty user turn with a
      // later model response is a real missing-transcript boundary, not silence.
      if (speaker === 'user' && turns.slice(index + 1).some(next => next.querySelector('.turn.model'))) emptyUserTurns += 1
      return
    }
    rows.push({
      // Current Live DOM has no durable message ID. Scope this positional ID to
      // one document/session; a navigation/reset must create a new capture epoch.
      sourceMessageId: `aistudio-web-turn-${index}`,
      speaker, text,
      status: content.querySelector('.streaming-output') ? 'streaming' : 'complete'
    })
  })
  return { rows, emptyUserTurns, turnCount: turns.length }
}
