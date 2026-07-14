// @vitest-environment jsdom
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseChatGPTPage } from './chatgpt-adapter'
import { SpeakSubStore } from './store'
import { mergeTranscriptEvent, subtitleEvents } from '../shared/transcript'
import type { TranscriptEvent } from '../shared/types'

describe('fake provider to archive integration', () => {
  it('carries parser output through transcript, subtitle and Markdown boundaries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-pipeline-'))
    try {
      document.body.innerHTML = '<article data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u1">I went to London.</div></article><article data-testid="conversation-turn-2"><div data-message-author-role="assistant" data-message-id="a1">What did you enjoy there?</div></article>'
      const store = new SpeakSubStore(directory); const session = store.createSession('normal'); let events: TranscriptEvent[] = []
      for (const row of parseChatGPTPage(document)) {
        const event: TranscriptEvent = { ...row, id: row.sourceMessageId, sessionId: session.id, speaker: row.speaker as TranscriptEvent['speaker'], receivedAt: '2026-01-01T00:00:00.000Z' }
        events = mergeTranscriptEvent(events, event); store.upsertEvent(event)
      }
      expect(subtitleEvents(events, 'both', 4).map((event) => event.text)).toEqual(['I went to London.', 'What did you enjoy there?'])
      expect(readFileSync(join(directory, 'current-practice.md'), 'utf8')).toContain('What did you enjoy there?')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
