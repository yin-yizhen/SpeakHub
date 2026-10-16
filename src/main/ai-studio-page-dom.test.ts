// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readAIStudioSnapshot } from './ai-studio-page-dom'

describe('observed AI Studio Live DOM', () => {
  it('attributes audio and typed turns without collecting labels, controls or account text', () => {
    document.body.innerHTML = `<nav>Account and settings</nav>
      <ms-bidi-turn><div class="author-label">User</div><div class="turn user"><ms-bidi-audio-part><div class="transcript">I like reading.</div></ms-bidi-audio-part></div></ms-bidi-turn>
      <ms-bidi-turn><div class="author-label">Model</div><div class="turn model"><ms-bidi-audio-stream-part><div class="streaming-output"><button>stop_circle</button></div><div class="transcript">What do you read?</div></ms-bidi-audio-stream-part></div></ms-bidi-turn>
      <ms-bidi-turn><div class="turn user"><ms-bidi-text-part><p>Please summarize.</p></ms-bidi-text-part><ms-bidi-audio-part></ms-bidi-audio-part></div></ms-bidi-turn>`
    expect(readAIStudioSnapshot(document)).toEqual({ turnCount: 3, emptyUserTurns: 0, rows: [
      { sourceMessageId: 'aistudio-web-turn-0', speaker: 'user', text: 'I like reading.', status: 'complete' },
      { sourceMessageId: 'aistudio-web-turn-1', speaker: 'assistant', text: 'What do you read?', status: 'streaming' },
      { sourceMessageId: 'aistudio-web-turn-2', speaker: 'user', text: 'Please summarize.', status: 'complete' }
    ] })
  })

  it('retains identity during partial/final updates and reports missing user transcription', () => {
    document.body.innerHTML = `<ms-bidi-turn><div class="turn user"><ms-bidi-audio-part></ms-bidi-audio-part></div></ms-bidi-turn>
      <ms-bidi-turn><div class="turn model"><ms-bidi-audio-stream-part><div class="streaming-output"></div><div class="transcript">Hello</div></ms-bidi-audio-stream-part></div></ms-bidi-turn>
      <ms-bidi-turn><div class="turn user"><ms-bidi-audio-part></ms-bidi-audio-part></div></ms-bidi-turn>`
    const first = readAIStudioSnapshot(document)
    expect(first.emptyUserTurns).toBe(1)
    document.querySelector('.streaming-output')!.remove()
    document.querySelector('.transcript')!.textContent = 'Hello again.'
    const final = readAIStudioSnapshot(document)
    expect(final.rows[0]).toEqual({ ...first.rows[0], text: 'Hello again.', status: 'complete' })
  })

  it('never guesses a speaker from alternating positions or reads arbitrary page text', () => {
    document.body.innerHTML = '<h1>Sign in</h1><textarea>Private draft</textarea><ms-bidi-turn><div class="transcript">Unknown role</div></ms-bidi-turn>'
    expect(readAIStudioSnapshot(document).rows).toEqual([])
  })
})
