// @vitest-environment jsdom
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseChatGPTPage } from './chatgpt-adapter'
import { readAIStudioSnapshot } from './ai-studio-page-dom'
import { SpeakSubStore } from './store'
import { mergeTranscriptEvent, subtitleEvents } from '../shared/transcript'
import type { TranscriptEvent } from '../shared/types'

describe('fake provider to archive integration', () => {
  it('carries AI Studio partial/final transcripts through subtitle chunks and one archive without duplicate text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-aistudio-pipeline-'))
    try {
      document.body.innerHTML = '<ms-bidi-turn><div class="turn user"><ms-bidi-audio-part><div class="transcript">I like reading.</div></ms-bidi-audio-part></div></ms-bidi-turn><ms-bidi-turn><div class="turn model"><ms-bidi-audio-stream-part><div class="streaming-output"></div><div class="transcript">What do you</div></ms-bidi-audio-stream-part></div></ms-bidi-turn>'
      const store = new SpeakSubStore(directory)
      const session = store.createSession({ topic: 'Gemini 网页测试', level: 'A1', correctionStrength: 'normal', source: 'gemini-web', mode: 'voice' })
      let events: TranscriptEvent[] = []
      const apply = (): void => {
        for (const row of readAIStudioSnapshot(document).rows) {
          const event = { ...row, id: row.sourceMessageId, sessionId: session.id, receivedAt: '2026-10-15T12:00:00.000Z' }
          events = mergeTranscriptEvent(events, event)
          store.upsertEvent(event)
        }
      }
      apply()
      document.querySelector('.turn.model .transcript')!.textContent = 'What do you read?'
      document.querySelector('.streaming-output')!.remove()
      apply()
      expect(subtitleEvents(events, 'both', 4).map(event => event.text)).toEqual(['I like reading.', 'What do you read?'])
      const markdown = readFileSync(join(directory, 'current-practice.md'), 'utf8')
      expect(markdown.match(/What do you read\?/g)).toHaveLength(1)
      expect(markdown).not.toContain('stop_circle')
      store.endSession(session); store.finalizeSession(session.id)
      expect(store.searchSessions({ text: 'reading' })).toHaveLength(1)
      expect(store.searchSessions({ source: 'gemini-web' })).toHaveLength(1)
      expect(store.searchSessions({ source: 'chatgpt-web' })).toHaveLength(0)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each(['legacy', 'current'])('carries %s parser output through transcript, subtitle and Markdown boundaries', (format) => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-pipeline-'))
    try {
      document.body.innerHTML = '<article data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u1">I went to London.</div></article><article data-testid="conversation-turn-2"><div data-message-author-role="assistant" data-message-id="a1">What did you enjoy there?</div></article>'
      if (format === 'current') document.body.innerHTML = '<div data-content-search-unit-key="fallback-turn-0:0:user"><div data-user-message-bubble="true">I went to London.<button>显示更多</button></div></div><div data-content-search-unit-key="fallback-turn-0:2:assistant"><div data-chatgpt-selection-message-id="a1"><div data-markdown-text-style="assistant-message">What did you enjoy there?</div></div></div>'
      const store = new SpeakSubStore(directory); const session = store.createSession('normal'); let events: TranscriptEvent[] = []
      for (const row of parseChatGPTPage(document)) {
        const event: TranscriptEvent = { ...row, id: row.sourceMessageId, sessionId: session.id, speaker: row.speaker as TranscriptEvent['speaker'], receivedAt: '2026-01-01T00:00:00.000Z' }
        events = mergeTranscriptEvent(events, event); store.upsertEvent(event)
      }
      expect(subtitleEvents(events, 'both', 4).map((event) => event.text)).toEqual(['I went to London.', 'What did you enjoy there?'])
      expect(readFileSync(join(directory, 'current-practice.md'), 'utf8')).toContain('What did you enjoy there?')
      store.endSession(session); store.finalizeSession(session.id)
      expect(store.searchSessions({ text: 'London' })).toHaveLength(1)
      expect(existsSync(join(directory, 'learning-index.json'))).toBe(true)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
