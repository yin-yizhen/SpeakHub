import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpeakSubStore } from './store'

const profile = { topic: '旅行英语' as const, level: 'B1' as const, correctionStrength: 'normal' as const, source: 'api-direct' as const, mode: 'text' as const }
const review = { topic: '旅行英语', summary: '表达清楚。', issues: [{ original: 'I go yesterday', improved: 'I went yesterday', reason: '使用过去时。' }], vocabulary: [{ term: 'persistent', meaning: '坚持的', example: 'She is persistent.' }], nextPractice: '继续练习过去时。', assessment: { estimatedCefr: 'B1' as const, scores: { accuracy: 72, vocabulary: 68, fluency: 75, interaction: 80 }, errorCategories: [{ category: 'tense' as const, count: 2 }], weakPoints: ['一般过去时'] } }

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
      expect(readdirSync(directory)).toContain('learning-index.json')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('keeps streaming subtitles in memory but archives only finalized turn text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-streaming-'))
    try {
      const store = new SpeakSubStore(directory)
      const session = store.createSession('normal')
      store.upsertEvent({ id: 'partial', sessionId: session.id, sourceMessageId: 'turn-1', speaker: 'assistant', text: 'partial token', status: 'streaming', receivedAt: '2026-01-01T00:00:00.000Z' })
      store.flushSession(session.id)
      expect(store.eventsForSession(session.id)).toHaveLength(1)
      expect(readFileSync(join(directory, 'current-practice.md'), 'utf8')).not.toContain('partial token')

      store.upsertEvent({ id: 'final', sessionId: session.id, sourceMessageId: 'turn-1', speaker: 'assistant', text: 'final answer', status: 'complete', receivedAt: '2026-01-01T00:00:01.000Z' })
      expect(readFileSync(join(directory, 'current-practice.md'), 'utf8')).toContain('final answer')
      expect(readFileSync(join(directory, 'current-practice.md'), 'utf8')).not.toContain('partial token')
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
      expect(readdirSync(directory)).toContain('learning-index.json')
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

  it('indexes full text, review details and next-practice profile', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-'))
    try {
      const store = new SpeakSubStore(directory, () => new Date('2026-07-10T10:00:00.000Z'))
      const session = store.createSession({ ...profile, focus: 'practice past tense' })
      store.upsertEvent({ id: 'u1', sessionId: session.id, sourceMessageId: 'u1', speaker: 'user', text: 'I go yesterday.', status: 'complete', receivedAt: '2026-07-10T10:01:00.000Z' })
      store.saveFavorite(session.id, 'persistent'); store.endSession(session); store.saveReview(session.id, review); store.finalizeSession(session.id)

      expect(store.searchSessions({ text: 'went yesterday', level: 'B1' })).toHaveLength(1)
      const summary = store.searchSessions()[0]
      expect(store.getSessionDetail(summary.id)).toMatchObject({ topic: '旅行英语', review: { assessment: { estimatedCefr: 'B1' } }, transcript: [{ text: 'I go yesterday.' }] })
      expect(store.createNextPracticeDraft(summary.id)).toMatchObject({ topic: '旅行英语', level: 'B1', focus: expect.stringContaining('一般过去时') })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('deduplicates vocabulary and schedules the three familiarity levels', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-'))
    try {
      const now = new Date('2026-07-10T10:00:00.000Z'); const store = new SpeakSubStore(directory, () => now)
      const session = store.createSession(profile); store.saveFavorite(session.id, ' Persistent '); store.saveFavorite(session.id, 'persistent'); store.endSession(session); store.saveReview(session.id, review); store.finalizeSession(session.id)
      expect(store.listVocabulary()).toHaveLength(1)
      const item = store.listVocabulary()[0]
      expect(item).toMatchObject({ normalizedTerm: 'persistent', occurrenceCount: 1, familiarity: 'unfamiliar', meaning: '坚持的' })
      expect(store.updateVocabularyFamiliarity(item.id, 'learning').nextReviewAt).toBe('2026-07-13T10:00:00.000Z')
      expect(store.updateVocabularyFamiliarity(item.id, 'mastered').nextReviewAt).toBe('2026-07-24T10:00:00.000Z')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('aggregates dashboard scores and permanently deletes the archive and vocabulary link', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-'))
    try {
      let now = new Date('2026-07-10T10:00:00.000Z'); const store = new SpeakSubStore(directory, () => now)
      const session = store.createSession(profile); store.saveFavorite(session.id, 'persistent'); now = new Date('2026-07-10T10:10:00.000Z'); store.endSession(session); store.saveReview(session.id, review); store.finalizeSession(session.id)
      const dashboard = store.getLearningDashboard('week')
      expect(dashboard).toMatchObject({ sessionCount: 1, totalMinutes: 10, newVocabulary: 1, dueVocabulary: 1, averageScores: { accuracy: 72 }, topErrors: [{ category: 'tense', count: 2 }] })
      const archived = store.searchSessions()[0]; store.deleteSession(archived.id)
      expect(store.searchSessions()).toEqual([]); expect(store.listVocabulary()).toEqual([])
      expect(readdirSync(directory).some((file) => file.startsWith('speaksub-practice-'))).toBe(false)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('rebuilds old Markdown archives when the JSON index is corrupt', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-'))
    try {
      writeFileSync(join(directory, 'speaksub-practice-legacy.md'), '---\nid: 11111111-1111-4111-8111-111111111111\nstartedAt: 2026-01-02T10:00:00.000Z\nendedAt: 2026-01-02T10:05:00.000Z\ncorrectionStrength: normal\n---\n\n# Speaking practice\n\n## Transcript\n\n### Me at 2026-01-02T10:01:00.000Z\n\nLegacy searchable sentence.\n\n## Saved vocabulary\n\n- legacy', 'utf8')
      writeFileSync(join(directory, 'learning-index.json'), '{broken', 'utf8')
      const store = new SpeakSubStore(directory)
      expect(store.searchSessions({ text: 'searchable sentence' })).toHaveLength(1)
      expect(store.listVocabulary()).toMatchObject([{ term: 'legacy' }])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
