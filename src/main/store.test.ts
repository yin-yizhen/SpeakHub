import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpeakSubStore } from './store'

describe('Markdown learning archive', () => {
  it('writes transcript and saved words to the one active temporary file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-'))
    try {
      const store = new SpeakSubStore(directory)
      const session = store.createSession('normal')
      store.upsertEvent({ id: 'event-1', sessionId: session.id, sourceMessageId: 'source-1', speaker: 'assistant', text: 'That makes sense.', status: 'complete', receivedAt: '2026-01-01T00:00:00.000Z' })
      store.saveFavorite(session.id, 'sense')
      store.saveFavorite(session.id, 'SENSE')

      const markdown = readFileSync(join(directory, 'current-practice.md'), 'utf8')
      expect(markdown).toContain('That makes sense.')
      expect(markdown).toContain('## Saved vocabulary\n\n- sense')
      expect(readdirSync(directory)).toEqual(['current-practice.md'])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('turns the active file into one final Markdown after the review is saved', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-'))
    try {
      const store = new SpeakSubStore(directory)
      const session = store.createSession('normal')
      const ended = store.endSession(session)
      store.saveReview(ended.id, { topic: 'Introductions', summary: 'Clear greeting.', issues: [], vocabulary: [{ term: 'hello', meaning: '你好', example: 'Hello, Sam.' }], nextPractice: 'Ask a follow-up question.' })
      const finalPath = store.finalizeSession(ended.id)

      expect(finalPath).toMatch(/speaksub-practice-.+\.md$/)
      expect(existsSync(join(directory, 'current-practice.md'))).toBe(false)
      expect(readFileSync(finalPath!, 'utf8')).toContain('## Review')
      expect(readFileSync(finalPath!, 'utf8')).toContain('Example: Hello, Sam.')
      expect(readdirSync(directory)).toHaveLength(1)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('preserves an interrupted temporary file before starting the next practice', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-'))
    try {
      const store = new SpeakSubStore(directory)
      store.createSession('normal')
      store.createSession('strict')
      expect(readdirSync(directory)).toContain('current-practice.md')
      expect(readdirSync(directory).some((file) => file.startsWith('speaksub-interrupted-'))).toBe(true)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
